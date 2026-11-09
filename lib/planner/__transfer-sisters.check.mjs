/**
 * UGA's answer for the same course number at sister schools
 * (transfer-sisters.ts), on the real lists and the files
 * scripts/data/uga-transfer-sisters.mjs builds from them.
 *
 *   node lib/planner/__transfer-sisters.check.mjs
 *
 * What must hold, whatever lists are present:
 *   - the school's own list always wins; a sister answer only fills a course
 *     the list does not have, or a school the planner holds no list for;
 *   - only a recognised school in a group that passed the hold-out test
 *     borrows: a lookalike in another state, a school in a group that failed
 *     the test, or a name shared with a school elsewhere and printed with no
 *     place borrows nothing;
 *   - a borrowed line says whose answer it is and that UGA's evaluation of the
 *     student's transcript decides;
 *   - "no credit" from the sisters turns the line off but keeps its switch;
 *   - a borrowed line is settled, so it is not sent to the model;
 *   - a home UGA record and the Illinois board are unchanged.
 * Course codes are picked from the built files at run time where the lists
 * may change (a code the group agrees on, at a school whose list lacks it),
 * so the check keeps testing the rule as lists are added.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }
`));
const T = await import(join(HERE, 'transcript.ts'));
const S = await import(join(HERE, 'transfer-sisters.ts'));
const O = await import(join(HERE, 'transfer-official.ts'));
const A = await import(join(HERE, 'transfer-ai.ts'));

let failures = 0;
const ok = (cond, name) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failures += 1; };
const read = (p) => JSON.parse(readFileSync(join(ROOT, 'public', p), 'utf8'));

const ugaCat = read('uga-catalog.json').filter((c) => typeof c?.code === 'string').map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: Number(c.code.match(/\d/)?.[0] ?? 0) * 100, cluster: c.cluster, tags: c.tags }));
const ilIdx = read('illinois/index.json');
const ilCat = (Array.isArray(ilIdx) ? ilIdx : ilIdx.courses).map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: c.level, cluster: c.cluster, tags: c.tags }));
const known = new Set(ugaCat.map((c) => c.code));
const index = read('uga-transfer/index.json');
const lists = {};
for (const f of readdirSync(join(ROOT, 'public', 'uga-transfer'))) if (f.endsWith('.json') && f !== 'index.json') lists[f.replace('.json', '')] = read(`uga-transfer/${f}`);
const sisterIndex = read('uga-transfer-sisters/index.json');
const sisterFiles = {};
for (const [gid, g] of Object.entries(sisterIndex.groups)) if (g.file) sisterFiles[gid] = read(`uga-transfer-sisters/${g.file}`);
const sisters = { index: sisterIndex, groups: sisterFiles };
const table = { index, schools: lists, sisters };
const without = { index, schools: lists };
/**
 * A Florida college the planner holds no UGA list for, by its full name: the
 * first member the sister index knows no list for (tonight's reading added
 * lists for many, so it is picked, not named). Null when every one has a list.
 */
const groupsDoc = JSON.parse(readFileSync(join(ROOT, 'scripts', 'data', 'uga-transfer-groups.json'), 'utf8'));
const noListCollege = groupsDoc.groups['fl-college'].members.find((m) => {
  const known = sisterIndex.groups['fl-college'].members.find((x) => x.names[0] === S.sisterName(m.name));
  return known && !known.key && !known.requirePlace && !O.ugaSchoolEntry(index, m.name);
})?.name ?? null;

const line = (code, title, credits, extra = {}) => ({ code, title, credits, grade: 'A', term: 'Fall 2025', status: 'completed', ...extra });
const match = (institution, lines, opts = {}) => T.matchTranscript({ institution, kind: 'transcript', hoursUnit: 'semester', courses: lines, exams: [], notes: [] }, 'check.pdf', opts.school === 'illinois' ? ilCat : ugaCat, ['check.pdf'], null, opts.school ?? 'uga', opts.table === undefined ? table : opts.table, null);
const spaced = (code) => code.replace(/^([A-Z]+)(\d)/, '$1 $2');
const keyOf = (name) => O.ugaSchoolEntry(index, name)?.key ?? null;
const kindOf = (rs) => (rs.some((r) => /^[A-Z]{2,5} \d{4}[A-Z]?$/.test(r)) ? 'course' : rs.some((r) => !/^NTFR\b/.test(r)) ? 'elective' : 'ntfr');

/**
 * A code the group answers, of one kind, that a given school's own list lacks
 * (or any code, for a school with no list), with at least `min` sisters.
 */
function pick(gid, kind, schoolKey, test = () => true) {
  const f = sisterFiles[gid];
  if (!f) return null;
  for (const [code, row] of Object.entries(f.courses)) {
    if (kindOf(row.r) !== kind || !test(code, row)) continue;
    if (schoolKey && lists[schoolKey]?.courses?.[code]?.length) continue;
    if (row.s.some((i) => f.schools[i].key === schoolKey)) continue;
    return { code: spaced(code), raw: code, row };
  }
  return null;
}

console.log('Which group a transcript\'s school belongs to (precision first):');
const groupOf = (name) => S.sisterGroupFor(sisterIndex, name, O.ugaSchoolEntry(index, name));
for (const [name, want] of [
  ['Georgia State University', 'usg'],
  ['Georgia Southern University', 'usg'],
  ['Georgia Institute of Technology', 'usg'],
  // Former names borrow because UGA's index opens the school's own list for
  // them (the builder's match words, in index.json since 2026-11-05). Before,
  // "East Georgia College" opened Georgia College's list and "Southwest
  // Georgia Technical College" West Georgia Tech's; a list for another school
  // means the name and the list disagree, so nothing was lent.
  ['East Georgia College', 'usg'],
  ['Southwest Georgia Technical College', 'tcsg'],
  ['Middle Georgia Technical College', 'tcsg'],
  ['Georgia Piedmont Technical College', 'tcsg'],
  ['South Georgia Technical College', 'tcsg'],
  ['Athens Tech', 'tcsg'],
  ['Valencia College', 'fl-college'],
  ['Daytona State College', 'fl-college'],
  ...(noListCollege ? [[noListCollege, 'fl-college']] : []),
  ['College of Central Florida', 'fl-college'],
  ['Seminole State College of Florida', 'fl-college'],
  ['Hillsborough College, Tampa, FL', 'fl-college'],
  ['Santa Fe College', 'fl-college'],
  ['Gordon College, Barnesville, GA', 'usg'],
  // North Carolina's and Tennessee's community colleges, rosters checked 2026-11-08.
  ['Central Piedmont Community College', 'nc-cc'],
  ['Wake Technical Community College', 'nc-cc'],
  ['Pellissippi State Community College', 'tn-cc'],
  ['Walters State Community College', 'tn-cc'],
  // Lookalikes and groups that did not pass: nothing borrowed.
  ['Piedmont Technical College', null],
  ['Piedmont University', null],
  ['Columbia State Community College', null],
  ['Columbia College', null],
  ['University of Central Florida', null],
  ['University of North Florida', null],
  ['Florida State University', null],
  ['Seminole State College', null],
  ['Santa Fe Community College', null],
  ['Santa Fe Community College, Santa Fe, NM', null],
  ['Hillsborough College', null],
  ['Gordon College', null],
  // Ohio's Columbus State Community College opens Columbus State University's
  // list by its words, and was Columbus Technical Institute until 1987.
  ['Columbus State Community College', null],
  ['Columbus State Community College, Columbus, OH', null],
  ['Columbus Technical Institute, Columbus, OH', null],
  ['Columbus Technical Institute', null],
  ['Columbus Technical Institute, Columbus', null],
  ['Columbus Technical Institute, Columbus, GA', 'tcsg'],
  ['Columbus State', null],
  ['Columbus State University', 'usg'],
  ['Columbus Technical College', 'tcsg'],
  // A Georgia name with a different state printed beside it.
  ['Gwinnett Technical College, Lawrenceville, OH', null],
  ['Kennesaw State University, Kennesaw, Ohio', null],
  ['Gwinnett Technical College, Lawrenceville, GA', 'tcsg'],
  ['Gwinnett Tech', 'tcsg'],
  ['Mississippi Gulf Coast Community College', null],
  ['Georgia Military College', null],
  ['Emory University', null],
  ['Sample State University', null],
  ['University of Georgia', null],
]) ok(groupOf(name) === want, `"${name}" -> ${want ?? 'no group'} (got ${groupOf(name) ?? 'no group'})`);
// Technical colleges printed with "Georgia Tech" in them are never Georgia
// Tech's University System group, whichever list the index opens for them.
for (const name of ['Wiregrass Georgia Tech', 'Wiregrass Georgia Tech College', 'Wiregrass Georgia Tech College in Valdosta, GA', 'Middle Georgia Tech', 'Heart of Georgia Tech', 'Central Georgia Tech', 'South Georgia Tech', 'West Georgia Tech'])
  ok(groupOf(name) !== 'usg', `"${name}" does not borrow from the University System (got ${groupOf(name) ?? 'no group'})`);
ok(['Georgia Tech', 'Georgia Institute of Technology'].every((n) => groupOf(n) === 'usg'), '"Georgia Tech" itself is still the University System');
{
  // The index opens East Georgia's own list for its former name, and the
  // same name borrows from its system; with Georgia College's list it would
  // not (the name and the list disagree).
  const gcsu = index.schools.find((s) => s.key === keyOf('Georgia College & State University'));
  ok(keyOf('East Georgia College') === keyOf('East Georgia State College') && S.sisterGroupFor(sisterIndex, 'East Georgia College', O.ugaSchoolEntry(index, 'East Georgia College')) === 'usg', '"East Georgia College" opens its own list and borrows from the University System');
  ok(S.sisterGroupFor(sisterIndex, 'East Georgia College', gcsu) === null, '"East Georgia College" with Georgia College\'s list borrows nothing');
}

console.log(`A Florida college with no UGA list (${noListCollege ?? 'none left'}) borrows from the Florida College System:`);
if (!noListCollege) ok(true, 'every Florida College System college has its own UGA list now; the gap-filling cases below still test the layer');
else {
  const enc = pick('fl-college', 'course', null, (c) => c === 'ENC1101') ?? pick('fl-college', 'course', null);
  const rec = match(noListCollege, [line(enc.code, 'English Composition I', 3), line('ENC 1101', 'English Composition I', 3, { grade: 'D' })]);
  const c = rec.courses[0];
  ok(keyOf(noListCollege) === null, `the planner holds no list for ${noListCollege}`);
  ok(c.counts === 'course' && c.matchedBy === 'sisters' && c.matched === enc.row.r.map(T.normalizeCourseCode).find((r) => known.has(r)), `${enc.code} counts as ${c.matched} from the sisters`);
  ok(c.basis?.from === 'sisters' && c.basis.badge === 'course', 'its basis says the sisters');
  ok(/^UGA's transfer lists for \d+ other Florida College System colleges \(/.test(c.basis?.text ?? ''), `the label names the group: "${(c.basis?.text ?? '').slice(0, 90)}..."`);
  ok(/for this same course number/.test(c.basis?.text ?? '') && /UGA's evaluation of your transcript decides\.$/.test(c.basis?.text ?? ''), 'the label says it is the same course number and that UGA\'s evaluation decides');
  ok((c.basis?.schools?.length ?? 0) === enc.row.s.length && (c.basis?.schools ?? []).every((n) => typeof n === 'string'), `every sister school is named in basis.schools (${c.basis?.schools?.length})`);
  ok(Boolean(c.basis?.source) && Boolean(c.basis?.checked), 'it links one of those lists, with the date it was read');
  ok(Boolean(rec.courses[1].gradeNote), 'a D still carries the grade note');
  ok(rec.notes.some((n) => /UGA's answer for the same course number at sister schools/.test(n)), 'the record note says some lines take a sister answer');
  ok(A.unsettledLines(rec, ugaCat, 'uga').every((l) => l.line !== 0), 'a sister-settled line is not sent to the model');
  const spc = pick('fl-college', 'course', null, (code, row) => row.r.includes('COMM 1100'));
  if (spc) {
    const s = match(noListCollege, [line(spc.code, 'Fundamentals of Speech Communication', 3)]).courses[0];
    ok(s.matchedBy === 'sisters' && s.matched === 'COMM 1110', `a sister answer in UGA's older number (COMM 1100) counts as today's COMM 1110 (got ${s.matched})`);
  }
}

console.log('A North Carolina or Tennessee community college with no UGA list borrows from its own system only:');
for (const [gid, code, title, want] of [['nc-cc', 'ENG111', 'Writing and Inquiry', 'ENGL 1101'], ['tn-cc', 'ENGL1010', 'English Composition I', 'ENGL 1101']]) {
  const college = groupsDoc.groups[gid].members.find((m) => {
    const known = sisterIndex.groups[gid].members.find((x) => x.names[0] === S.sisterName(m.name));
    return known && !known.key && !known.requirePlace && !O.ugaSchoolEntry(index, m.name);
  })?.name;
  const row = sisterFiles[gid]?.courses[code];
  if (!college || !row) { ok(false, `${gid}: a college with no list (${college}) and ${code} in its sister file (${Boolean(row)})`); continue; }
  const c = match(college, [line(spaced(code), title, 3)]).courses[0];
  ok(keyOf(college) === null && c.counts === 'course' && c.matchedBy === 'sisters' && c.matched === want && c.basis?.from === 'sisters', `${college}: ${spaced(code)} counts as ${want} from its sisters (got ${c.matched}/${c.matchedBy})`);
  ok(new RegExp(`^UGA's transfer lists for \\d+ other ${gid === 'nc-cc' ? 'North Carolina' : 'Tennessee'} community colleges \\(`).test(c.basis?.text ?? ''), `the label names the group: "${(c.basis?.text ?? '').slice(0, 80)}..."`);
  // The same code at a college in another state's system, or none, borrows nothing from this one.
  const other = match(gid === 'nc-cc' ? 'Piedmont Technical College' : 'Columbia College', [line(spaced(code), title, 3)]).courses[0];
  ok(other.matchedBy !== 'sisters' && other.basis?.from !== 'sisters', `a lookalike outside the group does not borrow ${spaced(code)} (${other.matchedBy})`);
}

console.log('The school\'s own list always wins:');
{
  const hit = Object.entries(lists['005074']?.courses ?? {}).find(([code]) => sisterFiles['fl-college']?.courses[code]);
  if (hit) {
    const [code] = hit;
    const c = match('Broward College', [line(spaced(code), 'A course', 3)]).courses[0];
    ok(c.basis?.from === 'official', `Broward's own list answers ${spaced(code)} (got ${c.basis?.from})`);
  }
  // A made-up sister file that disagrees with the school's own list: the list still answers.
  const atc = lists['000462'];
  const [code, own] = Object.entries(atc.courses).find(([, rs]) => rs.some((r) => /^[A-Z]{2,5} \d{4}$/.test(r) && known.has(r)));
  const fake = { index: sisterIndex, groups: { ...sisterFiles, tcsg: { ...sisterFiles.tcsg, courses: { ...sisterFiles.tcsg.courses, [code]: { r: ['NTFR'], s: [0, 1, 2, 3, 4] } } } } };
  const c = match('Athens Technical College', [line(spaced(code), 'A course', 3)], { table: { index, schools: lists, sisters: fake } }).courses[0];
  ok(c.matchedBy === 'official' && own.map(T.normalizeCourseCode).includes(c.matched), `Athens Tech's own ${spaced(code)} -> ${c.matched} beats a sister "no credit"`);
}

console.log('A Georgia school\'s list without the course: the gap is filled from its system:');
{
  // The Florida college with a list (Valencia), a course its list lacks.
  const v = pick('fl-college', 'course', '005869');
  if (v) {
    const c = match('Valencia College', [line(v.code, 'A course', 3)]).courses[0];
    ok(c.matchedBy === 'sisters' && c.basis?.from === 'sisters', `Valencia's list lacks ${v.code}: the sisters answer ${c.matched}`);
    ok(!(c.basis?.schools ?? []).includes('Valencia College'), 'Valencia is not named among its own sisters');
  }
  // A technical college whose list lacks a course the other colleges agree on.
  const t = pick('tcsg', 'course', keyOf('Atlanta Technical College'), (code, row) => row.r.some((r) => known.has(T.normalizeCourseCode(r))));
  if (t) {
    const c = match('Atlanta Technical College', [line(t.code, 'A course', 3)]).courses[0];
    ok(c.matchedBy === 'sisters' && /other Georgia technical colleges/.test(c.basis?.text ?? ''), `Atlanta Tech lacks ${t.code}: ${c.matched}, "${(c.basis?.text ?? '').slice(0, 70)}..."`);
  }
  const u = pick('usg', 'course', keyOf('Gordon State College'), (code, row) => row.r.some((r) => known.has(T.normalizeCourseCode(r))));
  if (u) {
    ok(match('Gordon College, Barnesville, GA', [line(u.code, 'A course', 3)]).courses[0].matchedBy === 'sisters', `"Gordon College, Barnesville, GA" borrows ${u.code} from the University System`);
    ok(match('Gordon College', [line(u.code, 'A course', 3)]).courses[0].matchedBy !== 'sisters', '"Gordon College" with no place (also a Massachusetts college) borrows nothing');
  }
}

console.log('Lookalikes and groups that did not pass borrow nothing:');
{
  const enc = pick('fl-college', 'course', null);
  for (const name of ['University of North Florida', 'Seminole State College', 'Santa Fe Community College', 'Sample State University']) {
    const c = match(name, [line(enc.code, 'A course', 3)]).courses[0];
    ok(c.basis?.from !== 'sisters' && c.matchedBy !== 'sisters', `${name}: ${enc.code} is not borrowed (${c.basis?.from}/${c.matchedBy})`);
  }
  const fsu = pick('fl-college', 'course', keyOf('Florida State University'));
  if (fsu) {
    const c = match('Florida State University', [line(fsu.code, 'A course', 3)]).courses[0];
    ok(c.matchedBy !== 'sisters', `Florida State University (a university, not a college) does not borrow the colleges' ${fsu.code}`);
  }
  const uc = pick('usg', 'course', keyOf('Columbus State University'));
  if (uc) {
    for (const name of ['Columbus State Community College', 'Columbus State Community College, Columbus, OH']) {
      const c = match(name, [line(uc.code, 'A course', 3)]).courses[0];
      ok(c.matchedBy !== 'sisters' && c.basis?.from !== 'sisters', `${name} (Ohio): ${uc.code} is not borrowed from the University System (${c.basis?.from}/${c.matchedBy})`);
    }
  }
  const tc = pick('tcsg', 'course', null);
  for (const name of ['Piedmont Technical College', 'Central Piedmont Community College', 'Trident Technical College']) {
    const c = match(name, [line(tc.code, 'A course', 3)]).courses[0];
    ok(c.matchedBy !== 'sisters' && c.basis?.from !== 'sisters', `${name}: Georgia's technical colleges lend nothing (${tc.code})`);
  }
  // A list added after the sister files were built: its school is not in
  // their index yet, so it borrows nothing until they are rebuilt.
  const stale = { ...index, schools: [...index.schools, { key: '999999', name: 'Florida Gateway College', system: 'other', match: ['florida gateway college'], readAt: '2026-11-05', rows: 1, courses: 1 }] };
  ok(S.sisterGroupFor(sisterIndex, 'Florida Gateway College', O.ugaSchoolEntry(stale, 'Florida Gateway College')) === null, 'a school whose list is newer than the sister files borrows nothing until they are rebuilt');
  // A group whose roster has not been checked against the system's own list lends nothing, whatever the test says.
  for (const gid of ['sc-tech', 'al-cc', 'fl-university']) ok(sisterIndex.groups[gid] && sisterIndex.groups[gid].file === null, `${gid} lends nothing`);
  // North Carolina's and Tennessee's rosters were checked against each system's own list (2026-11-08): they lend course credit at 5 or more lists, nothing else.
  for (const gid of ['nc-cc', 'tn-cc']) ok(Boolean(sisterIndex.groups[gid]?.file) && sisterFiles[gid]?.rules?.course === 'exact/unanimous/5+' && !sisterFiles[gid]?.rules?.ntfr && !sisterFiles[gid]?.rules?.elective && Object.keys(sisterFiles[gid]?.courses ?? {}).length > 0, `${gid} lends course credit at 5+ lists only (${Object.keys(sisterFiles[gid]?.courses ?? {}).length} codes)`);
  // Without the sister files (they failed to load) the matcher behaves as before.
  const c = match(noListCollege ?? 'Daytona State College', [line(enc.code, 'A course', 3)], { table: without }).courses[0];
  ok(c.basis?.from !== 'sisters', 'with no sister files loaded, nothing is borrowed');
}

console.log('A school known to the sister index by a newer or older name is not its own sister:');
{
  const tcc = keyOf('Tallahassee Community College');
  // UGA's index knows the 2025 name since 2026-11-05 (the builder's match
  // words), so the college's own list answers first.
  ok(Boolean(tcc) && keyOf('Tallahassee State College') === tcc, '"Tallahassee State College" (the 2025 name) opens Tallahassee Community College\'s own list');
  const enc = tcc && pick('fl-college', 'course', null, (code, row) => row.s.some((i) => sisterFiles['fl-college'].schools[i].key === tcc));
  if (enc) {
    const c = match('Tallahassee State College', [line(enc.code, 'A course', 3)]).courses[0];
    ok(c.basis?.from === 'official', `"Tallahassee State College": ${enc.code} comes from its own list (${c.basis?.from})`);
    // An index without that word: the sister layer still recognises the name,
    // and its own list must never be counted among its sisters.
    const old = { ...table, index: { ...index, schools: index.schools.map((s) => (s.key === tcc ? { ...s, match: s.match.filter((w) => w !== 'tallahassee state college') } : s)) } };
    const d = match('Tallahassee State College', [line(enc.code, 'A course', 3)], { table: old }).courses[0];
    const names = d.basis?.schools ?? [];
    ok(d.basis?.from !== 'sisters' || !names.includes('Tallahassee Community College'), `with an index that misses the name, ${enc.code} does not count Tallahassee Community College's own list among its sisters (${d.basis?.from}, ${names.length} schools)`);
  } else ok(false, 'no Florida college code that Tallahassee Community College\'s own list shares with its sisters');
}

console.log('No credit, elective credit and the rules each group passed:');
{
  const nt = pick('tcsg', 'ntfr', null, (code, row) => row.s.length >= 3 && /^[A-Z]{4}\d{4}$/.test(code) && Object.keys(lists).some((k) => sisterFiles.tcsg.schools.some((s) => s.key === k) && !lists[k].courses[code]?.length));
  const lacking = nt && sisterFiles.tcsg.schools.find((s) => !lists[s.key]?.courses?.[nt.raw]?.length);
  if (lacking) {
    const rec = match(lacking.name, [line(nt.code, 'A course', 3)]);
    const c = rec.courses[0];
    ok(c.counts === 'none' && c.use === false && c.basis?.from === 'sisters' && c.basis.badge === 'none', `${lacking.name} lacks ${nt.code}: the sisters' no credit turns it off`);
    ok(c.status === 'completed', 'its status is left alone, so the review list keeps its switch');
    ok(/^UGA gives no credit for this course number at \d+ other Georgia technical colleges/.test(c.basis?.text ?? '') && /UGA's evaluation of your transcript decides\./.test(c.basis?.text ?? ''), `the label: "${(c.basis?.text ?? '').slice(0, 100)}..."`);
    const on = T.setLineCounts(rec, 0, { counts: 'hours' });
    ok(on.courses[0].use && on.courses[0].counts === 'hours', 'the student can count it as hours');
  }
  // The Florida colleges passed for counting a course only: a code they all
  // mark NTFR is not in their file, so it is never borrowed as "no credit".
  ok(Object.values(sisterFiles['fl-college']?.courses ?? {}).every((row) => kindOf(row.r) === 'course'), 'the Florida College System file lends courses only (its "no credit" did not pass)');
  ok(Object.values(sisterFiles.usg?.courses ?? {}).every((row) => kindOf(row.r) !== 'elective'), 'the University System file lends no elective designations (they did not pass outside TCSG)');
  // The System's "no credit" passed only on learning-support codes, which the
  // planner turns off before it borrows; on college-level codes it had 6.
  ok(!sisterIndex.groups.usg?.lends?.noCredit && Object.values(sisterFiles.usg?.courses ?? {}).every((row) => kindOf(row.r) !== 'ntfr'), 'the University System file lends no "no credit"');
  ok(Object.values(sisterFiles).every((f) => Object.keys(f.courses).every((code) => !/^[A-Z]+0\d{2,3}[A-Z]{0,2}$/.test(code))), 'no file holds a learning-support code (the planner turns those off first; the test does not score them)');
  const el = pick('tcsg', 'elective', null);
  const elLacking = el && sisterFiles.tcsg.schools.find((s) => !lists[s.key]?.courses?.[el.raw]?.length && !el.row.s.includes(sisterFiles.tcsg.schools.indexOf(s)));
  if (elLacking) {
    const c = match(elLacking.name, [line(el.code, 'A course', 3)]).courses[0];
    ok(c.counts === 'hours' && c.use && c.basis?.from === 'sisters' && ['elective', 'core'].includes(c.basis.badge) && c.designation === O.ugaDesignation(el.row.r[0])?.code, `${elLacking.name} lacks ${el.code}: ${c.designation}, ${c.basis?.badge} hours from the sisters`);
    ok(/UGA's evaluation of your transcript decides\./.test(c.basis?.text ?? ''), 'the elective label says UGA\'s evaluation decides');
  }
  // A school whose own list failed to load is never its own sister: the answer must stand on enough others.
  const three = pick('tcsg', 'course', null, (code, row) => row.s.length === 3) ?? pick('tcsg', 'ntfr', null, (code, row) => row.s.length === 3);
  if (three) {
    const voter = sisterFiles.tcsg.schools[three.row.s[0]];
    const { [voter.key]: _gone, ...rest } = lists;
    const c = match(voter.name, [line(three.code, 'A course', 3)], { table: { index, schools: rest, sisters } }).courses[0];
    ok(c.basis?.from !== 'sisters', `${voter.name}'s list not loaded: ${three.code} (3 lists, one its own) is not borrowed from 2`);
  }
}

console.log('Home UGA records and the Illinois board are unchanged:');
{
  const home = match('University of Georgia', [line('ENGL 1101', 'English Composition I', 3), line('HIST 1GHX', 'US History', 3, { from: noListCollege ?? 'Daytona State College' })]);
  ok(home.courses[0].matchedBy === 'code' && home.courses[0].matched === 'ENGL 1101', 'a UGA course on a UGA record counts by its code');
  ok(home.courses.every((c) => c.basis?.from !== 'sisters'), 'nothing on a home record comes from the sisters');
  const enc = pick('fl-college', 'course', null);
  const il = match(noListCollege ?? 'Daytona State College', [line(enc.code, 'English Composition I', 3)], { school: 'illinois' });
  ok(il.courses.every((c) => c.basis?.from !== 'sisters' && c.matchedBy !== 'sisters'), 'the same Florida college line on the Illinois board never uses UGA\'s sisters');
  const withS = match('Georgia State University', [line('ENGL 1101', 'English Composition I', 3)]).courses[0];
  const withoutS = match('Georgia State University', [line('ENGL 1101', 'English Composition I', 3)], { table: without }).courses[0];
  ok(JSON.stringify(withS) === JSON.stringify(withoutS), 'a line the school\'s own list answers is identical with or without the sister files');
}

console.log(failures === 0 ? 'transfer sisters check: all right' : `transfer sisters check: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
