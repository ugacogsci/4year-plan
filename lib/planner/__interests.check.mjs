/**
 * What the student wants, heard correctly: lib/planner/career-tracks.ts
 * interestProfile, and the product path that reads goals from the career words
 * alone.
 *
 * Every phrase below was heard wrong on 2026-09-24:
 *
 *   - The major's own name was a goal. "Psychology" with an empty "after"
 *     answer was heard as psychology/counseling/therapy and booked PSYC 238
 *     Psychopathology and SOCW 200 as "named for the goal you gave"; "Computer
 *     science" was software engineering; an I/O psychology student ("HR,
 *     industrial organizational psychology") was given the clinical topic too,
 *     because none named the workplace side.
 *   - A refused or retracted goal stayed a goal. "no med school for me" was
 *     pre-medicine, and a Kinesiology student who added "I want to coach" was
 *     booked eight pre-med courses. "my sister is pre-law" gave the student a
 *     law topic. ALMA's stored words only grew, so "pre-med" followed by
 *     "actually I don't want to do pre-med anymore, I want UX research" kept
 *     the pre-medicine track on every rebuild.
 *   - A goal said in chat left ALMA with no idea which of the track's
 *     required courses the re-pick had placed.
 *
 * The first part is pure (interestProfile, careerWordsAfter,
 * trackRequiredStatus). The second builds the browser's context from the
 * shipped artifacts, the way __prior-credit.check.mjs does, and runs the
 * scorer and generatePlan with `interests` (the studying answer plus the career
 * words, for free words) and `career` (the career words alone, for goals), as
 * components/planner/planner-workspace.tsx passes them. Exits non-zero on any
 * FAIL.
 *
 *   node lib/planner/__interests.check.mjs        (about half a minute)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));
const { interestProfile, careerWordsAfter, trackRequiredStatus, CAREER_TRACKS, INTEREST_TOPICS } = await import(join(HERE, 'career-tracks.ts'));
const { generatePlan, qualityScorer } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow } = await import(join(HERE, 'illinois-load.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

let failures = 0;
function check(ok, label, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- interestProfile ---------------------------------------------------------
/*
 * [text, heard]: the exact `heard` list, tracks by id then topics by label, in
 * the order the student named them.
 */
const HEARD = [
  // #17: a major's name is not a goal, and psychology is not only therapy.
  ['Psychology', []],
  ['Psychology.', []],
  ['I want to go to grad school for psychology', []],
  ['HR, industrial organizational psychology', ['industrial-organizational psychology/HR']],
  ['I want to be an industrial-organizational psychologist', ['industrial-organizational psychology/HR']],
  ['I/O psych, maybe people analytics', ['industrial-organizational psychology/HR', 'data science/analytics']],
  ['I want to work in HR', ['industrial-organizational psychology/HR']],
  ['a cognitive psychologist', []],
  ['developmental psychology research', []],
  ['social psychology', []],
  ['I want to be a clinical psychologist', ['psychology/counseling/therapy']],
  ['I want to be a psychologist', ['psychology/counseling/therapy']],
  ['school psychologist', ['psychology/counseling/therapy']],
  ['I want to be a therapist, mental health counselor', ['psychology/counseling/therapy']],
  ['clinical psychology, maybe counseling', ['psychology/counseling/therapy']],
  ['clinical/community psychology', ['psychology/counseling/therapy']],
  ['I want 15 hr semesters and a data job', ['data science/analytics']],
  // #20: refusals and retractions.
  ['no med school for me', []],
  ['no med school for me, I want to coach', []],
  ['no more pre-med', []],
  ['med school is not for me', []],
  ["law school isn't for me, I want finance", ['finance/investment banking']],
  ['Pre-med? No. PT school', ['pre-physical-therapy']],
  ['pre-med, not for me', []],
  ['I am not pre-med anymore, I want to do data science', ['data science/analytics']],
  ['pre-med I am not pre-med anymore, I want to do data science', ['data science/analytics']],
  ['pre-med never mind, not pre-med', []],
  ["physical therapy school actually I changed my mind, I'd rather do sports management", ['sports management/business']],
  ["I don't want to do PT anymore", []],
  ['I want to go to law school. Law school is not for me, I want finance', ['finance/investment banking']],
  ['never mind about pre-med, I want physical therapy', ['pre-physical-therapy']],
  ['I want AI. I changed my mind about pre-med', ['AI/machine learning']],
  ['I changed my mind from engineering to pre-med', ['pre-medicine']],
  // #39: ALMA's stored words with the retraction appended.
  ["pre-med actually I don't want to do pre-med anymore, I want UX research", ['UX/HCI design']],
  // Third person, for tracks and topics alike.
  ['my sister is pre-law', []],
  ['my sister wants to be a lawyer', []],
  ['my brother went to med school, I want engineering', []],
  ['my sister is pre-law and so am I', ['pre-law']],
  ['my dad is a lawyer but I want finance', ['finance/investment banking']],
  ['my brother got into law school', []],
  ['my friend got me into data science', ['data science/analytics']],
  // What must stay heard.
  ['pre-law', ['pre-law']],
  ['pre-med', ['pre-medicine']],
  ['PT school', ['pre-physical-therapy']],
  ['I want to go to med school but not to be a surgeon', ['pre-medicine']],
  ["I've never changed my mind, I want med school", ['pre-medicine']],
  ["I haven't changed my mind, still pre-med", ['pre-medicine']],
  ['not sure if pre-med or pre-PT', ['pre-medicine', 'pre-physical-therapy']],
  ["I don't know whether law school is for me", ['pre-law']],
  ['I used to want to be a doctor, now I want PT school', ['pre-physical-therapy']],
  ["my dad's a doctor so I've always wanted to be a doctor", ['pre-medicine']],
  ['my mom is a nurse so I want to be one', ['nursing']],
  ['UX, no question', ['UX/HCI design']],
  ['I have no idea, maybe med school', ['pre-medicine']],
  ['I want to go to vet school or med school', ['pre-veterinary', 'pre-medicine']],
  ['I love biology and want to be a doctor someday', ['pre-medicine']],
  ['I play AI in a video game club', ['AI/machine learning', 'game design']],
];
console.log('\ninterestProfile: what a sentence names');
for (const [text, want] of HEARD) {
  const got = interestProfile(text).heard;
  check(same(got, want), JSON.stringify(text), same(got, want) ? '' : `heard ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// The I/O topic's courses and title words exist in the catalog, as the file's header promises.
{
  const rows = read('illinois/index.json');
  const codes = new Set(rows.map((r) => norm(r.code)));
  const topic = INTEREST_TOPICS.find((t) => t.id === 'io-psychology-hr');
  const missing = (topic?.courses ?? []).filter((c) => !codes.has(norm(c)));
  check(Boolean(topic) && missing.length === 0, 'every io-psychology-hr course is in public/illinois/index.json', missing.join(', '));
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const deadWords = (topic?.words ?? []).filter((w) => !rows.some((r) => new RegExp(`\\b${esc(w)}`).test(r.title.toLowerCase())));
  check(deadWords.length === 0, 'every io-psychology-hr title word starts a word in some title', deadWords.join(', '));
}

// ---- careerWordsAfter: ALMA's add, replace and clear ----------------------------
console.log('\ncareerWordsAfter: the stored career words after set_priorities');
{
  const heardAfter = (current, said, mode) => interestProfile(careerWordsAfter(current, said, mode)).heard;
  check(same(careerWordsAfter('pre-med', 'also AI', 'add'), 'pre-med. also AI'), 'add appends a sentence of its own');
  check(same(careerWordsAfter('', 'pre-med', 'add'), 'pre-med'), 'add to nothing stores the words');
  check(same(careerWordsAfter('pre-med. also AI', 'AI', 'add'), 'pre-med. also AI'), 'add skips words already stored');
  check(same(heardAfter('not pre-med anymore', 'pre-med', 'add'), ['pre-medicine']), 'add of a goal taken back earlier takes it up again');
  check(same(heardAfter('no med school for me', 'I want to coach, maybe data', 'add'), ['data science/analytics']), 'an earlier refusal does not reach into the next thing said');
  check(same(heardAfter('pre-med', "actually I don't want to do pre-med anymore, I want UX research", 'add'), ['UX/HCI design']), 'add of a retraction drops pre-med (#39)');
  check(same(heardAfter('pre-med', 'I want UX research instead', 'add'), ['pre-medicine', 'UX/HCI design']), 'add of a new goal alone keeps both, which is why replace exists');
  check(same(heardAfter('pre-med', 'I want UX research instead', 'replace'), ['UX/HCI design']), 'replace keeps the new goal alone');
  check(careerWordsAfter('pre-med', '', 'replace') === 'pre-med', 'replace with no words keeps what is stored');
  check(careerWordsAfter('pre-med', '', 'clear') === '' && same(heardAfter('pre-med', 'forget pre-med', 'clear'), []), 'clear drops everything');
}

// ---- trackRequiredStatus: what set_priorities tells ALMA (#23) ---------------
console.log('\ntrackRequiredStatus: a track against a board');
{
  const pt = CAREER_TRACKS.find((t) => t.id === 'pre-physical-therapy');
  const board = new Map([['PHYS 101', 'Fall 2027'], ['PSYC 100', 'Spring 2027'], ['IB 150', 'Fall 2026']]);
  const held = new Set(['STAT 100']);
  const status = trackRequiredStatus(pt, (code) => board.get(code) ?? null, (code) => held.has(code));
  const required = pt.courses.filter((c) => c.need === 'required').length;
  check(status.planned.includes('PHYS 101 in Fall 2027') && status.planned.includes('PSYC 100 in Spring 2027'), 'planned rows name their term', status.planned.join('; '));
  check(status.planned.some((x) => x.startsWith('IB 150 in')), 'an alternative on the board counts for its row (MCB 150 or IB 150)');
  check(status.held.includes('STAT 100'), 'a held course is reported as taken');
  check(status.missing.some((x) => x.startsWith('PHYS 102')) && status.missing.some((x) => x.startsWith('CHEM 102')), 'missing rows are listed', status.missing.join('; '));
  check(status.planned.length + status.held.length + status.missing.length === required, `every required row is reported once (${required})`);
}

// ---- the product path: goals from the career words alone (#17, #20) --------
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const offeringsFile = existsSync(join(PUBLIC, 'illinois', 'offerings.json')) ? read('illinois/offerings.json') : null;
if (offeringsFile) { const { applyOfferings } = await import(join(HERE, 'illinois-load.ts')); applyOfferings(rows, offeringsFile); }
const languagesFile = existsSync(join(PUBLIC, 'illinois', 'languages.json')) ? read('illinois/languages.json') : null;
const grades = new Map(); for (const g of read('illinois/grades.json')) grades.set(norm(g.code), toGradeRow(g, byCode.get(norm(g.code))?.title ?? g.code, []));
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const context = { courses: rows, prereqs: new Map(Object.entries(read('illinois/prereqs.json'))), grades, sections: new Map(), equivalents: equivalents.size ? equivalents : undefined, exclusions: new Map(Object.entries(read('illinois/exclusions.json'))), creditRanges, bands: meta.bands, offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(), offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined, offeringTerms: offeringsFile ? offeringsFile.terms : undefined, offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined, languages: languagesFile ?? undefined, snapshotTerm: null, prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q) };
const summaries = read('illinois/programs.json');
function load(id) { const s = summaries.find((p) => p.id === id); const raw = read(`illinois/program/${id}.json`); const a = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [raw] }, new Map(byCode)); return { s, name: a.programs[0]?.name ?? s.name, college: a.programs[0]?.college, total: s.totalCredits || a.programs[0]?.totalCredits || 120, blocks: a.blocks.get(id) ?? [] }; }
const BALANCED = { workload: 1, teaching: 1, relevance: 1, coverage: 1, schedule: 0, noEarly: false, format: 'any' };
const RELEVANT = { ...BALANCED, relevance: 2 };
const NAMED = 'named for the goal you gave';
/** The workspace's two texts: the studying answer joined to the career words, and the career words alone. */
const said = (studying, career) => ({ interests: [studying, career].join(' '), career });

console.log('\nqualityScorer: the studying answer names no goal');
{
  const psyc = load('las/psychology-bslas');
  const score = (who, code) => qualityScorer({ context, requirements: psyc.blocks, programName: psyc.name, priorities: RELEVANT, ...who })(code);
  const empty = said('Psychology', '');
  for (const code of ['PSYC 238', 'PSYC 379', 'SOCW 200', 'PSYC 336']) {
    const q = score(empty, code);
    check(!q.reasons.includes(NAMED), `Psychology, empty "after": ${code} is not ${NAMED}`, q.reasons.join('; '));
  }
  const io = said('Psychology', 'HR, industrial organizational psychology');
  check(!score(io, 'PSYC 238').reasons.includes(NAMED), 'Psychology, "HR, industrial organizational psychology": PSYC 238 Psychopathology is not named for the goal');
  check(score(io, 'PSYC 245').reasons.includes(NAMED), 'Psychology, "HR, industrial organizational psychology": PSYC 245 Industrial Org Psych is');
  check(score(io, 'LER 182').reasons.includes(NAMED), 'Psychology, "HR, industrial organizational psychology": LER 182 Introduction to Human Resource is');
  // A caller that passes no career words is read the old way, whole.
  check(score({ interests: 'I want to be a therapist' }, 'PSYC 238').reasons.includes(NAMED), 'no `career` given: goals are read from `interests`, as before');

  const cs = load('engineering/computer-science-bs');
  const csScore = qualityScorer({ context, requirements: cs.blocks, programName: cs.name, priorities: RELEVANT, ...said('Computer science', '') });
  const named = ['CS 124', 'CS 128', 'CS 222', 'CS 340', 'CS 427', 'CS 409'].filter((code) => csScore(code).reasons.includes(NAMED));
  check(named.length === 0, 'Computer science, empty "after": no software engineering course is named for a goal', named.join(', '));
}

console.log('\ngeneratePlan: what a Rebuild books');
function plan(id, studying, career) {
  const p = load(id);
  return generatePlan({
    requirements: p.blocks, context,
    prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] },
    horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true },
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: BALANCED },
    programId: id, degreeTotal: p.total, programName: p.name, programCollege: p.college, ...said(studying, career),
  });
}
{
  const g = plan('las/psychology-bslas', 'Psychology', '');
  const named = g.electives.filter((e) => (e.reasons ?? []).includes(NAMED)).map((e) => e.code);
  check(named.length === 0, `Psychology, empty "after": no elective is ${NAMED}`, named.join(', '));
}
{
  const g = plan('ahs/kinesiology-bs/applied-exercise-science', 'Kinesiology', 'no med school for me, I want to coach');
  const track = g.electives.filter((e) => e.why.startsWith('For ')).map((e) => e.code);
  check(track.length === 0, 'Kinesiology, "no med school for me, I want to coach": no pre-med course is booked', track.join(', '));
}
{
  const g = plan('ahs/kinesiology-bs/applied-exercise-science', 'Kinesiology', 'physical therapy school');
  const track = g.electives.filter((e) => e.why.startsWith('For Pre-physical therapy')).map((e) => e.code);
  check(track.length > 0, 'Kinesiology, "physical therapy school": the pre-PT track still books its courses', `${track.length} booked`);
}
{
  const g = plan('las/political-science-balas/general-political-science', 'Political science', 'my sister is pre-law');
  const named = g.electives.filter((e) => (e.reasons ?? []).includes(NAMED)).map((e) => e.code);
  check(named.length === 0, `Political science, "my sister is pre-law": no elective is ${NAMED}`, named.join(', '));
}

console.log(failures === 0 ? '\nevery case heard as the student meant it' : `\n*** ${failures} FAIL ***`);
process.exitCode = failures === 0 ? 0 : 1;
