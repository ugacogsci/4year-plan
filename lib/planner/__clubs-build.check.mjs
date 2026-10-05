/**
 * The club build (scripts/illinois/clubs/build.mjs), its privacy guard, and
 * the reading-pass scaffolding (batches.mjs, store-facts.mjs), on made-up
 * data first, then on public/illinois/clubs.json when the build has run.
 *
 * Each case is a rule the design sets because something went wrong before:
 *   - the syllabus build emptied its output when its inputs were missing;
 *   - a prototype made 78 links up from off-site URLs;
 *   - the directory page carries about 1,200 student contact names, and the
 *     clubs own their words: nothing personal and no 8-word run of a club's
 *     text may ship;
 *   - a reading-pass goal with no agreeing directory category, or a goal id
 *     the other session renamed, must not reach a student;
 *   - Orange groups drop off the directory around Jun 1 and often come back.
 *
 *   node lib/planner/__clubs-build.check.mjs        (a few seconds)
 *
 * Exits non-zero on any FAIL.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLUBS = join(ROOT, 'scripts', 'illinois', 'clubs');
const G = await import(pathToFileURL(join(CLUBS, 'guard.mjs')).href);
const B = await import(pathToFileURL(join(CLUBS, 'build.mjs')).href);
const R = await import(pathToFileURL(join(CLUBS, 'batches.mjs')).href);
const S = await import(pathToFileURL(join(CLUBS, 'store-facts.mjs')).href);

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? ` (${detail})` : ''}`));
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const run = (script, env) => spawnSync(process.execPath, [join(CLUBS, script), ...(env.args ?? [])], { env: { ...process.env, ...env.vars }, encoding: 'utf8' });

const MISSION = 'We build autonomous rovers and compete every spring at the national rover challenge in Alabama with students from many majors.';
const BENEFITS = 'Members learn machining, embedded programming and teamwork while traveling to competitions.';

// ---------------------------------------------------------------------------
// fixtures: what tag.mjs and parse.mjs write

const VOCAB = {
  topical: ['Business', 'Law', 'Technology, Engineering & Mathematics', 'Social & Leisure', 'Health & Human Sciences', 'Faith, Religion & Spirituality'],
  affiliations: ['Grainger College of Engineering'],
};
const row = (id, name, o = {}) => ({
  id: String(id), name, url: `https://one.illinois.edu/Club${id}/`, profile: `https://one.illinois.edu/Club${id}/`, categories: ['Technology, Engineering & Mathematics'],
  kind: 'competition-team', kindFrom: 'category', identity: false, audience: 'undergrad', audienceFrom: 'default', joining: 'open',
  goals: [], subjects: [], colleges: [], lists: [], missionWords: 40, hash: `h${id}`, firstSeen: '2026-09-01', lastSeen: '2026-10-04', ...o,
});
const fixture = () => {
  const clubs = [
    row(1, 'Rover Team', { goals: [{ id: 'robotics', from: 'name' }], affiliations: ['Grainger College of Engineering'], colleges: ['engineering'] }),
    row(2, 'Accounting Club', { categories: ['Business'], kind: 'academic', goals: [{ id: 'accounting', from: 'name' }], website: 'https://acct.example.org', profile: undefined, url: 'https://acct.example.org' }),
    row(3, 'Grainger Robotics Office', { office: true, kind: null, dropped: 'office', audience: null }),
    row(4, 'Criminal Law Society', { categories: ['Law'], kind: 'academic', audience: 'law', audienceFrom: 'name', dropped: 'law' }),
    row(5, 'Pre-Law Society', { categories: ['Law'], kind: 'pre-professional', goals: [{ id: 'pre-law', from: 'list', list: 0 }], lists: [0] }),
  ].map((c) => { if (c.profile === undefined) delete c.profile; return c; });
  const tagged = {
    version: 1, checked: '2026-10-04', source: { name: 'OneIllinois', url: 'https://one.illinois.edu/club_signup', host: 'one.illinois.edu' },
    lists: [{ id: 'prelaw', title: 'Pre-Law Student Orgs', short: "Pre-Law Advising's list", url: 'https://publish.illinois.edu/prelaw/', read: '2026-10-04', goal: 'pre-law', weight: 1 }],
    clubs,
  };
  const directory = {
    version: 1, source: { name: 'OneIllinois', url: 'https://one.illinois.edu/club_signup', page: 'https://one.illinois.edu/club_signup?view=all&', host: 'one.illinois.edu' },
    checked: '2026-10-04', calendar: null, guard: { ok: true, failures: [] }, counts: { onPage: 5, parsed: 5 }, vocabulary: VOCAB,
    groups: clubs.map((c) => ({ id: c.id, name: c.name })), missing: [],
  };
  const texts = new Map(clubs.map((c) => [c.id, `${MISSION}\n${BENEFITS}`]));
  return { tagged, directory, texts };
};

// ---------------------------------------------------------------------------
console.log('\nThe text and privacy rules (guard.mjs)');

expect(G.sharedRun('they build autonomous rovers and compete every spring at the national level', MISSION) === 'build autonomous rovers and compete every spring at', 'an 8-word run from the club\'s text is found');
expect(G.sharedRun('they build autonomous rovers and compete every spring for fun', MISSION) === null, 'seven shared words are not a copy');
expect(G.sharedRun('Builds rovers for a national challenge.', MISSION) === null, 'our own words are not a copy');
expect(G.personalIn('write to jane.doe@illinois.edu').length === 1 && G.personalIn('call (217) 555-0100').length === 1 && G.personalIn('https://one.illinois.edu/x?uid=99').length === 1 && G.personalIn('/send_message_boot?club_id=1').length === 1 && G.personalIn('mailto:x').length === 1, 'emails, phone numbers, uid=, message links and mailto: are personal');
expect(G.personalIn('WPGU-FM 107.1').length === 0 && G.personalIn('Pre-Law Advising\'s 2025–26 list').length === 0, 'a club name with numbers is not');
const tooLong = Array.from({ length: 21 }, (_, i) => `w${i}`).join(' ');
expect(/21 words/.test(G.doesProblem(tooLong, '') ?? '') && /characters/.test(G.doesProblem('x'.repeat(141), '') ?? '') && /email/.test(G.doesProblem('Email a@b.co to join.', '') ?? ''), 'does: at most 20 words, 140 characters, nothing personal');
expect(/copies/.test(G.doesProblem('Members build autonomous rovers and compete every spring at the national challenge.', MISSION) ?? '') && /not here/.test(G.doesProblem('Builds rovers.', null) ?? '') && G.doesProblem('Builds rovers for a national challenge.', MISSION) === null, 'does: no copied run, and no line ships unchecked');

// ---------------------------------------------------------------------------
console.log('\nThe reading pass\'s facts, onto a tagged row (applyFacts)');

{
  const base = row(10, 'Robotics Builders', { kind: 'academic', categories: ['Technology, Engineering & Mathematics'] });
  const fact = { id: '10', hash: 'h10', kind: 'competition-team', identity: false, audience: 'undergrad', joining: 'application', goals: ['robotics', 'accounting'], does: 'Builds rovers for a national challenge.' };
  const r = B.applyFacts(base, fact, { source: MISSION });
  expect(r.used && r.row.kind === 'competition-team' && r.row.joining === 'application', 'a fact for the same text: the reader\'s kind and how to join');
  expect(r.row.goals.map((g) => `${g.id}/${g.from}`).join() === 'robotics/reading' && r.notes.goalsDisagreed === 1, 'a reading goal is kept only where a directory category agrees (robotics yes, accounting no)');
  expect(r.row.does === 'Builds rovers for a national challenge.', 'a does line that passes the rules ships');
  const stale = B.applyFacts(base, { ...fact, hash: 'old' }, { source: MISSION });
  expect(!stale.used && stale.notes.stale === 1 && stale.row === base, 'a fact for older text is not used at all');
  const nat = B.applyFacts({ ...base, kind: 'professional-society', kindFrom: 'national' }, fact, { source: MISSION });
  const ovr = B.applyFacts({ ...base, audience: 'check', audienceFrom: 'override' }, { ...fact, audience: 'grad' }, { source: MISSION });
  expect(nat.row.kind === 'professional-society' && ovr.row.audience === 'check' && !ovr.row.dropped, 'hand-checked rows win: a national row\'s kind, an override\'s audience');
  const grad = B.applyFacts(base, { ...fact, audience: 'grad' }, { source: MISSION });
  const unclear = B.applyFacts(base, { ...fact, audience: 'unclear' }, { source: MISSION });
  expect(grad.row.dropped === 'graduate' && unclear.row.audience === 'check', 'the reader\'s "grad" drops the club; "unclear" raises audience check');
  const social = B.applyFacts({ ...base, goals: [{ id: 'robotics', from: 'name' }] }, { ...fact, kind: 'social' }, { source: MISSION });
  expect(social.row.goals.length === 0, 'a club the reader calls social carries no career goals');
  const removed = B.applyFacts(base, fact, { source: MISSION, override: { goalsRemove: ['robotics'] } });
  expect(removed.row.goals.length === 0, 'an override\'s goalsRemove reaches reading-pass goals too');
  const copied = B.applyFacts(base, { ...fact, does: 'We build autonomous rovers and compete every spring at the national rover challenge.' }, { source: MISSION });
  expect(!copied.row.does && /copies/.test(copied.notes.doesDropped), 'a does line that copies 8 words is left out');
  const noText = B.applyFacts(base, fact, { source: null });
  expect(!noText.row.does, 'without the club\'s text to check against, no does line ships');
  expect(throws(() => B.applyFacts(base, { ...fact, goals: ['research'] }, { source: MISSION }), /not a current/), 'a goal id that is not current stops the build');
  expect(throws(() => B.applyFacts(base, { ...fact, kind: 'club' }, { source: MISSION }), /unknown kind/), 'an unknown kind stops the build');
}

// ---------------------------------------------------------------------------
console.log('\nThe file (buildClubsFile)');

{
  const { tagged, directory, texts } = fixture();
  const { file, report } = B.buildClubsFile({ tagged, directory, texts, builtAt: 'T' });
  const ids = file.clubs.map((c) => c.id);
  expect(ids.join() === '2,5,1', 'offices and law-school groups are dropped; the rest ship, sorted by name', ids.join());
  expect(file.counts.dropped.office === 1 && file.counts.dropped.law === 1 && file.counts.shipped === 3 && file.counts.onPage === 5 && file.counts.parsed === 5 && file.counts.unlisted === 0 && !('hidden' in file.counts.dropped), 'counts: the page\'s own number, what was parsed, shipped and dropped by reason');
  const one = file.clubs.find((c) => c.id === '1');
  expect(!['kindFrom', 'audienceFrom', 'missionWords', 'hash', 'restricted', 'goalsHeldBack', 'dropped', 'office', 'events'].some((k) => k in one), 'internal fields stay behind; no events key when the calendar was not read');
  expect(file.clubs.find((c) => c.id === '2').url === 'https://acct.example.org' && !('profile' in file.clubs.find((c) => c.id === '2')), 'a club with no profile links its own website');
  expect(report.facts.used === 0 && file.calendar === null, 'no facts, no calendar: nothing invented');
  expect(B.shippedProblems(file, { texts, vocabulary: VOCAB }).length === 0, 'the privacy guard passes a clean file');

  const withCal = { ...directory, calendar: { url: 'https://one.illinois.edu/ical/x.ics', lastModified: 'Sun', read: '2026-10-04', etag: 'e', events: 9 } };
  const events = { clubs: { 1: { last: '2026-09-30', next: ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30'], n120: 5, events: [['2026-09-30', 'Meeting']] } } };
  const cal = B.buildClubsFile({ tagged, directory: withCal, events, texts, builtAt: 'T' }).file;
  expect(JSON.stringify(cal.clubs.find((c) => c.id === '1').events) === '{"last":"2026-09-30","next":["2026-10-09","2026-10-16","2026-10-23"],"n120":5}' && JSON.stringify(cal.clubs.find((c) => c.id === '2').events) === '{"n120":0}', 'with the calendar: last, up to 3 next and n120; a club with none says n120 0');
  expect(JSON.stringify(cal.calendar) === '{"url":"https://one.illinois.edu/ical/x.ics","lastModified":"Sun","read":"2026-10-04"}', 'the calendar stamp ships without its etag or counts');

  // a club whose only link was a placeholder (parse.mjs dropped https://example.com/) and that the calendar named no profile for
  const linkless = { ...tagged, clubs: [...tagged.clubs, (() => { const c = row(6, 'Animal Liberation UIUC', { categories: ['Advocacy & Activism'], kind: 'government-advocacy', url: null }); delete c.profile; return c; })()] };
  const ll = B.buildClubsFile({ tagged: linkless, directory: { ...directory, groups: linkless.clubs.map((c) => ({ id: c.id, name: c.name })) }, texts, builtAt: 'T' });
  expect(!ll.file.clubs.some((c) => c.id === '6') && ll.file.counts.dropped.noLink === 1 && ll.report.noLink.length === 1 && B.shippedProblems(ll.file, { texts, vocabulary: VOCAB }).length === 0, 'a club with no link at all is left out and counted (counts.dropped.noLink), never given a made-up one', JSON.stringify(ll.file.counts.dropped));
  expect(!('noLink' in file.counts.dropped), 'noLink is in the counts only when a club was left out for it');

  // the grace window
  const prev = {
    clubs: [
      { ...B.shipRow(row(20, 'Gone Lately', { lastSeen: '2026-07-01' })) },
      { ...B.shipRow(row(21, 'Gone Long Ago', { lastSeen: '2026-05-01' })) },
      { ...B.shipRow(row(22, 'Gone And Hidden', { lastSeen: '2026-09-01' })) },
    ],
  };
  const g = B.buildClubsFile({ tagged, directory, texts, previous: prev, overrides: { 22: { hide: true, note: 'x' } }, builtAt: 'T' });
  const kept = g.file.clubs.find((c) => c.id === '20');
  expect(kept?.lastSeen === '2026-07-01' && g.file.counts.unlisted === 1 && !g.file.clubs.some((c) => c.id === '21' || c.id === '22') && g.report.grace.expired === 1, 'a club the directory stopped listing stays 120 days after it was last seen, then goes; an override can still hide it');

  // facts through the whole build
  const facts = { facts: { 1: { id: '1', hash: 'h1', kind: 'competition-team', identity: false, audience: 'undergrad', joining: 'audition', goals: ['robotics', 'hardware'], does: 'Builds rovers for a national challenge.' } } };
  const f = B.buildClubsFile({ tagged, directory, texts, facts, builtAt: 'T' });
  const fr = f.file.clubs.find((c) => c.id === '1');
  expect(fr.does === 'Builds rovers for a national challenge.' && fr.joining === 'audition' && fr.goals.map((x) => `${x.id}/${x.from}`).join() === 'robotics/name,hardware/reading' && f.report.facts.used === 1, 'facts.json: does, joining and an agreeing reading goal reach the file');

  // inconsistent inputs throw, so main() writes nothing
  expect(throws(() => B.buildClubsFile({ tagged: { ...tagged, checked: '2026-09-01' }, directory, texts }), /run tag\.mjs again/), 'tags from another day than the directory: stop');
  expect(throws(() => B.buildClubsFile({ tagged, directory: { ...directory, guard: { ok: false, failures: ['short'] } }, texts }), /count guard failed/), 'a directory whose count guard failed: stop');
  expect(throws(() => B.buildClubsFile({ tagged: { ...tagged, clubs: [...tagged.clubs, row(6, 'Old Name', { goals: [{ id: 'research', from: 'name' }] })] }, directory: { ...directory, groups: [...directory.groups, { id: '6' }] }, texts }), /not current/), 'a goal id the other session renamed: stop');
  expect(throws(() => B.buildClubsFile({ tagged: null, directory, texts }), /not a version-1/), 'no tag file: stop');
}

// ---------------------------------------------------------------------------
console.log('\nThe privacy guard on the finished file (shippedProblems)');

{
  const { tagged, directory, texts } = fixture();
  const good = B.buildClubsFile({ tagged, directory, texts, builtAt: 'T' }).file;
  const bad = (mutate, re, label) => {
    const f = structuredClone(good);
    mutate(f);
    const p = B.shippedProblems(f, { texts, vocabulary: VOCAB });
    expect(p.some((x) => re.test(x)), label, p.join(' | ') || 'no problem found');
  };
  bad((f) => { f.clubs[0].mission = 'x'; }, /"mission" is not on the shipped whitelist/, 'a field off the whitelist (a mission)');
  bad((f) => { f.clubs[0].contact = 'Jane Doe'; }, /"contact" is not on the shipped whitelist/, 'a contact field');
  bad((f) => { f.clubs[0].name = 'Rover Team (jane.doe@illinois.edu)'; }, /email address/, 'an email in a name');
  bad((f) => { f.clubs[0].does = 'Call 217-555-0100 to join.'; }, /phone number/, 'a phone number');
  bad((f) => { f.clubs[1].profile = 'https://one.illinois.edu/www.aim-illinois.com/'; f.clubs[1].url = f.clubs[1].profile; }, /is not a one\.illinois\.edu profile/, 'a profile link made up from an off-site link');
  bad((f) => { f.clubs[1].url = 'https://example.org/'; }, /url is neither its profile nor its website/, 'a link that is neither the profile nor the website');
  bad((f) => { f.clubs[0].categories.push('Made Up'); }, /not one of the directory's tags/, 'a category the directory does not have');
  bad((f) => { f.clubs[0].audience = 'grad'; }, /does not ship/, 'a graduate-only club');
  bad((f) => { f.clubs[0].goals.push({ id: 'research', from: 'name' }); }, /not a current goal id/, 'a goal id that is not current');
  bad((f) => { f.clubs[0].does = Array.from({ length: 21 }, () => 'word').join(' '); }, /does is 21 words/, 'a does over 20 words');
  bad((f) => { f.lists[0].title = 'y'.repeat(250); }, /which is prose/, 'a string over 200 characters');
  bad((f) => { f.clubs[0].does = 'Members build autonomous rovers and compete every spring at the national.'; }, /copies "/, 'a run of 8 words from a club\'s own text');
  bad((f) => { f.clubs.push(structuredClone(f.clubs[0])); }, /appears twice/, 'a repeated id');
  bad((f) => { f.clubs[0].starter = 'sometimes'; }, /starter "sometimes" is not true or 'undeclared'/, "a starter that is neither true nor 'undeclared'");
  expect(B.shipRow({ ...B.shipRow(good.clubs[0]), starter: 'undeclared' }).starter === 'undeclared' && B.shipRow({ ...B.shipRow(good.clubs[0]), starter: true }).starter === true && B.shippedProblems({ ...good, clubs: good.clubs.map((c, i) => (i === 0 ? { ...c, starter: 'undeclared' } : c)) }, { texts, vocabulary: VOCAB }).length === 0, "a starter for undeclared students ships as 'undeclared' (after the 2026-10-05 spot check)");
  expect(B.shippedProblems({ ...good, clubs: good.clubs.map((c) => ({ ...c, name: `${MISSION}` })) }, { texts, vocabulary: VOCAB }).every((x) => !/copies/.test(x)), 'a club\'s name may appear in its own text');

  expect(B.sizeProblems(good, null).some((x) => /under the floor of 900/.test(x)), 'fewer than 900 clubs in October: stop');
  const many = { ...good, clubs: Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })), counts: { onPage: 1000, parsed: 1000 } };
  expect(B.sizeProblems({ ...many, checked: '2026-07-01', clubs: many.clubs.slice(0, 650) }, null).length === 0, 'June 1 to September 15 the floor is 600');
  expect(B.sizeProblems({ ...many, clubs: many.clubs.slice(0, 900) }, { clubs: many.clubs.concat(many.clubs.slice(0, 200)) }).some((x) => /drop over 15%/.test(x)) && B.sizeProblems({ ...many, clubs: many.clubs.slice(0, 900) }, { clubs: many.clubs.concat(many.clubs.slice(0, 200)) }, { acceptDrop: true }).length === 0, 'a drop over 15% against the last file stops, unless --accept-drop');
  expect(B.sizeProblems({ ...many, counts: { onPage: 1000, parsed: 990 } }, null).some((x) => /parsed 990/.test(x)), 'a parse short of the page\'s own count stops');
  const text = B.serialize(good);
  expect(JSON.stringify(JSON.parse(text)) === JSON.stringify(good) && text.split('\n').length === good.clubs.length + 3, 'one club per line, and it reads back the same');
}

// ---------------------------------------------------------------------------
console.log('\nThe reading-pass scaffolding');

{
  const { tagged } = fixture();
  const texts = new Map(tagged.clubs.map((c) => [c.id, { id: c.id, name: c.name, hash: c.hash, mission: MISSION, benefits: BENEFITS }]));
  const all = R.clubsToRead({ tagged, texts, facts: null });
  expect(all.todo.map((c) => c.id).join() === '1,2,5' && all.skipped.office === 1 && all.skipped.dropped === 1, 'batches: every club the build would ship, never offices or dropped groups');
  const some = R.clubsToRead({ tagged, texts, facts: { facts: { 1: { hash: 'h1' }, 2: { hash: 'old' } } } });
  expect(some.todo.map((c) => c.id).join() === '2,5' && some.skipped.unchanged === 1, 'only clubs whose text changed since facts.json, or never read');
  expect(R.clubsToRead({ tagged, texts, facts: { facts: { 1: { hash: 'h1' } } }, all: true }).todo.length === 3 && R.clubsToRead({ tagged, texts, facts: null, includeDropped: true }).todo.length === 4, '--all reads them all again; --include-dropped adds the dropped groups (not offices)');
  const header = R.valuesHeader();
  expect(/kind: pre-professional \|/.test(header) && /audience: undergrad \| both \| grad \| law \| med \| vet \| unclear/.test(header) && /pre-law\s+Pre-law \(JD\)/.test(header) && header.split('\n').filter((l) => /^ {4}\S/.test(l)).length === 44, 'each batch lists the allowed values and the 44 current goal ids');
  const factsRows = { facts: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(100 + i), { id: String(100 + i), hash: `x${i}`, kind: 'academic', identity: false, audience: i % 7 === 0 ? 'unclear' : 'undergrad', joining: 'open', goals: i % 2 ? ['robotics'] : [] }])) };
  const ttexts = new Map(Object.values(factsRows.facts).map((f) => [f.id, { id: f.id, name: `Club ${f.id}`, hash: f.hash, mission: 'm', benefits: 'b' }]));
  const tt = { clubs: Object.values(factsRows.facts).map((f) => ({ id: f.id, name: `Club ${f.id}`, categories: [] })) };
  const s1 = R.checkSample({ facts: factsRows, texts: ttexts, tagged: tt, n: 40, seed: '2026-10-04' });
  const s2 = R.checkSample({ facts: factsRows, texts: ttexts, tagged: tt, n: 40, seed: '2026-10-04' });
  expect(s1.length === 40 && JSON.stringify(s1) === JSON.stringify(s2) && s1.filter((c) => c.stored.goals.length).length >= 20 && new Set(s1.map((c) => c.id)).size === 40, 'the checker\'s sample: 40 different clubs, half with goals, the same for the same seed');

  const text = { id: '1', name: 'Rover Team', hash: 'h1', mission: MISSION, benefits: BENEFITS };
  const good = { id: '1', hash: 'h1', kind: 'competition-team', identity: false, audience: 'undergrad', joining: 'open', goals: ['robotics', 'research'], does: 'Builds rovers for a national challenge.' };
  const c1 = S.checkEntry(good, { batchHash: 'h1', text, readAt: '2026-10-05' });
  expect(c1.fact?.goals.join() === 'robotics' && c1.fact.does && c1.fact.name === 'Rover Team' && c1.problems.some((p) => /"research" is not a current goal id/.test(p)), 'store-facts keeps a good entry, without a goal id that is not current');
  expect(!S.checkEntry({ ...good, hash: 'h0' }, { batchHash: 'h1', text, readAt: 'd' }).fact && !S.checkEntry(good, { batchHash: 'h1', text: { ...text, hash: 'h2' }, readAt: 'd' }).fact && !S.checkEntry(good, { batchHash: undefined, text, readAt: 'd' }).fact, 'an entry for other text, changed text or no batch is rejected');
  expect(!S.checkEntry({ ...good, kind: 'club' }, { batchHash: 'h1', text, readAt: 'd' }).fact && !S.checkEntry({ ...good, audience: 'everyone' }, { batchHash: 'h1', text, readAt: 'd' }).fact && !S.checkEntry({ ...good, identity: 'no' }, { batchHash: 'h1', text, readAt: 'd' }).fact, 'a value off the lists is rejected');
  const cp = S.checkEntry({ ...good, does: 'We build autonomous rovers and compete every spring at the national rover challenge.' }, { batchHash: 'h1', text, readAt: 'd' });
  expect(cp.fact && !cp.fact.does && cp.problems.some((p) => /copies/.test(p)), 'a copied does line is left out; the rest of the entry is kept');
  const journal = [JSON.stringify({ agent: 'reader-1', result: { clubs: [good] } }), 'not json', JSON.stringify({ x: { y: [{ clubs: [{ ...good, id: '5' }] }] } })].join('\n');
  expect([...S.entriesIn(journal, true)].map((e) => e.id).join() === '1,5', 'every { clubs: [...] } in a journal is found, however deep');
  const ser = S.serializeFacts({ 10: { id: '10' }, 9: { id: '9' } });
  expect(Object.keys(JSON.parse(ser).facts).join() === '9,10' && ser.split('\n').length === 5, 'facts.json: one club a line, in id order');
}

// ---------------------------------------------------------------------------
console.log('\nThe scripts end to end, in a scratch folder (never wipe; batches -> store-facts -> build)');

{
  const tmp = mkdtempSync(join(tmpdir(), 'clubs-build-check-'));
  try {
    const data = join(tmp, 'data');
    const out = join(tmp, 'clubs.json');
    const factsFile = join(tmp, 'facts.json');
    mkdirSync(data, { recursive: true });
    const vars = { CLUBS_DATA: data, CLUBS_OUT: out, CLUBS_FACTS: factsFile };
    writeFileSync(out, 'SENTINEL');

    const r0 = run('build.mjs', { vars });
    expect(r0.status !== 0 && readFileSync(out, 'utf8') === 'SENTINEL' && /left as it was/.test(r0.stderr), 'no inputs: the build stops and leaves the shipped file as it was');

    // a thousand made-up clubs, so the floor holds
    const { tagged, directory } = fixture();
    const many = Array.from({ length: 950 }, (_, i) => row(1000 + i, `Club ${String(i).padStart(4, '0')}`, { kind: 'academic', categories: ['Business'] }));
    tagged.clubs.push(...many);
    directory.groups.push(...many.map((c) => ({ id: c.id, name: c.name })));
    directory.counts = { onPage: tagged.clubs.length, parsed: tagged.clubs.length };
    writeFileSync(join(data, 'tagged.json'), JSON.stringify({ ...tagged, checked: '2026-09-30' }));
    writeFileSync(join(data, 'directory.json'), JSON.stringify(directory));
    writeFileSync(join(data, 'texts.jsonl'), tagged.clubs.map((c) => JSON.stringify({ id: c.id, name: c.name, hash: c.hash, mission: MISSION, benefits: BENEFITS })).join('\n') + '\n');
    const r1 = run('build.mjs', { vars });
    expect(r1.status !== 0 && readFileSync(out, 'utf8') === 'SENTINEL', 'tags from another day: stops, file untouched');

    writeFileSync(join(data, 'tagged.json'), JSON.stringify({ ...tagged, clubs: tagged.clubs.map((c) => (c.id === '1' ? { ...c, name: 'Rover Team (rovers@illinois.edu)' } : c)) }));
    const r2 = run('build.mjs', { vars });
    expect(r2.status !== 0 && readFileSync(out, 'utf8') === 'SENTINEL' && /privacy guard/.test(r2.stderr), 'an email that would ship: the privacy guard stops the build, file untouched');

    writeFileSync(join(data, 'tagged.json'), JSON.stringify(tagged));
    const r3 = run('batches.mjs', { vars });
    const index = JSON.parse(readFileSync(join(data, 'reading', 'index.json'), 'utf8'));
    expect(r3.status === 0 && index.clubs === 953 && index.batches.length === 39 && existsSync(join(data, 'reading', 'batch-001.txt')), 'batches.mjs: 953 clubs to read in 39 batches of 25', r3.stderr || r3.stdout.split('\n')[0]);

    const results = [
      { id: '1', hash: 'h1', kind: 'competition-team', identity: false, audience: 'undergrad', joining: 'audition', goals: ['robotics'], does: 'Builds rovers for a national challenge.' },
      { id: '2', hash: 'h2', kind: 'academic', identity: false, audience: 'undergrad', joining: 'open', goals: ['accounting'], does: 'We build autonomous rovers and compete every spring at the national rover challenge.' },
      { id: '5', hash: 'h5', kind: 'clubhouse', identity: false, audience: 'undergrad', joining: 'open', goals: [] },
    ];
    writeFileSync(join(tmp, 'journal.jsonl'), `${JSON.stringify({ result: { clubs: results } })}\n`);
    const r4 = run('store-facts.mjs', { vars, args: [join(tmp, 'journal.jsonl')] });
    const facts = JSON.parse(readFileSync(factsFile, 'utf8')).facts;
    expect(r4.status === 0 && Object.keys(facts).join() === '1,2' && facts['1'].does && !facts['2'].does && /1 rejected/.test(r4.stdout), 'store-facts.mjs: keeps the good entries, drops the copied line, rejects the bad kind', r4.stdout.split('\n')[0]);
    expect(!JSON.stringify(facts).includes('autonomous rovers and compete'), 'facts.json holds none of the club\'s own words');

    const r5 = run('batches.mjs', { vars });
    expect(/951 clubs to read/.test(r5.stdout), 'the next batches.mjs skips the clubs facts.json already has', r5.stdout.split('\n')[0]);

    const r6 = run('build.mjs', { vars });
    const built = existsSync(out) && readFileSync(out, 'utf8') !== 'SENTINEL' ? JSON.parse(readFileSync(out, 'utf8')) : null;
    const rover = built?.clubs.find((c) => c.id === '1');
    expect(r6.status === 0 && built?.clubs.length === 953 && rover?.does === 'Builds rovers for a national challenge.' && rover.joining === 'audition', 'build.mjs with good inputs: writes the file, with the reading pass\'s line and how to join', (r6.stderr || r6.stdout).split('\n')[0]);

    // the next build after the directory lost 20%: refused, unless --accept-drop
    const fewer = { ...tagged, clubs: tagged.clubs.slice(0, 760) };
    writeFileSync(join(data, 'tagged.json'), JSON.stringify(fewer));
    writeFileSync(join(data, 'directory.json'), JSON.stringify({ ...directory, groups: directory.groups.slice(0, 760), counts: { onPage: 760, parsed: 760 } }));
    const before = readFileSync(out, 'utf8');
    const r7 = run('build.mjs', { vars });
    expect(r7.status !== 0 && readFileSync(out, 'utf8') === before && /758 clubs listed against 953/.test(r7.stderr), 'a listed count that fell over 15% stops, though the grace window would keep the shipped count level; last file kept', r7.stderr.split('\n')[0]);
    const r8 = run('build.mjs', { vars, args: ['--accept-drop'] });
    expect(r8.status !== 0 && readFileSync(out, 'utf8') === before && /under the floor of 900/.test(r8.stderr) && !/drop over 15%/.test(r8.stderr), 'with --accept-drop the 15% guard yields, and the floor still holds (758 listed is under 900)', (r8.stderr || '').split('\n')[0]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
const REAL = join(ROOT, 'public', 'illinois', 'clubs.json');
if (!existsSync(REAL)) {
  console.log('\n(no public/illinois/clubs.json: run scripts/illinois/clubs/build.mjs for the real-data checks)');
} else {
  console.log('\nThe shipped file (public/illinois/clubs.json)');
  const file = JSON.parse(readFileSync(REAL, 'utf8'));
  const dirFile = join(ROOT, 'data', 'clubs', 'directory.json');
  const vocabulary = existsSync(dirFile) ? JSON.parse(readFileSync(dirFile, 'utf8')).vocabulary : null;
  const texts = B.readTexts(join(ROOT, 'data', 'clubs', 'texts.jsonl'));
  const problems = B.shippedProblems(file, { texts, vocabulary });
  expect(problems.length === 0, `the privacy guard passes it${texts ? ` (copy rule against ${texts.size} club texts)` : ' (no texts.jsonl here: copy rule not run)'}`, problems.slice(0, 5).join(' | '));
  expect(file.clubs.length >= 900 && file.counts.parsed === file.counts.onPage && file.counts.shipped === file.clubs.length, `${file.clubs.length} clubs; parsed ${file.counts.parsed} of the page's ${file.counts.onPage}`);
  const days = Math.round((Date.now() - Date.parse(`${file.checked}T12:00:00Z`)) / 86_400_000);
  expect(days <= 120, `checked ${file.checked}, ${days} days ago (stale after 120)`);
  expect(file.clubs.every((c) => c.url) && file.clubs.every((c) => !c.url.startsWith('https://one.illinois.edu/') || /^https:\/\/one\.illinois\.edu\/[^/.]+\/$/.test(c.url)), 'every club has a link, and no OneIllinois link has a dot in its slug');
  expect(file.source.name === 'OneIllinois' && file.source.url === 'https://one.illinois.edu/club_signup', 'the source is named in the file');
  const d = file.counts.dropped;
  expect(d.office === 46 && d.graduate + d.law + d.medical + d.veterinary >= 60, `dropped: ${Object.entries(d).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const placeholder = file.clubs.filter((c) => [c.url, c.website].some((u) => u && /^https?:\/\/([^/]*\.)?(example\.(com|net|org)|example|test|invalid|localhost)(:\d+)?(\/|$)|^https?:\/\/(localhost|\d{1,3}(\.\d{1,3}){3}|\[)/i.test(u)));
  expect(placeholder.length === 0 && !file.clubs.some((c) => c.id === '36823' && /example\.com/.test(c.url)), 'no club links a placeholder address (example.com, localhost ...); Animal Liberation UIUC no longer links https://example.com/', placeholder.map((c) => `${c.id} ${c.url}`).join('; '));
  if (file.calendar) {
    const n120 = file.clubs.filter((c) => c.events?.n120 > 0).length;
    const next = file.clubs.filter((c) => c.events?.next?.length).length;
    expect(file.clubs.every((c) => c.events && Number.isInteger(c.events.n120)) && /^\d{4}-\d{2}-\d{2}$/.test(file.calendar.read), `with the calendar read ${file.calendar.read}, every club carries its events (${n120} with one in the last 120 days, ${next} with one coming up)`);
  }
}

console.log(failures ? `\n*** ${failures} check(s) failed ***` : '\nall club build checks passed');
if (failures) process.exitCode = 1;
