/**
 * How well the transfer checker reads another school's courses, at UGA and at
 * Illinois, as numbers.
 *
 *   node scripts/dev/transfer-bench.mjs [--list]
 *
 * Two made-up transcripts from a school neither university's lists cover, so
 * every line goes through the content matcher (transfer-match.ts) the way a
 * student's would: common courses in the wording other colleges use. Each
 * line names the right equivalent at each school (any of several when more
 * than one is right, none when no single course is). A line is
 *   counted right   - counted as a right course automatically
 *   offered right   - the right course offered for the student to confirm
 *   counted WRONG   - counted as a course that is not right (the worst case)
 *   offered wrong   - only a wrong course offered
 *   missed          - an equivalent exists and nothing was offered
 *   right as hours  - no single course is right, and it counts as hours
 * Prints the totals per school, and with --list every line not counted right.
 *
 * Sister schools (transfer-sisters.ts), UGA only, rules only (the model is
 * never asked, even with --ai):
 *   D  a Florida college UGA's lists do not cover (the first one the sister
 *      files know no list for; Florida Gateway College on 2026-11-05),
 *      common courses under Florida's statewide numbers, scored as above with
 *      the sister answers and without them;
 *   E  every school with a list in a group that lends, hidden in turn: its
 *      list is removed, the group's answers are rebuilt from the other lists
 *      (scripts/data/uga-transfer-sisters.mjs), and each line the sisters
 *      answer is compared with what the school's own list makes of it,
 *      through the same matcher a student's transcript goes through.
 *   --no-sisters skips D and E.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
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
const T = await import(join(ROOT, 'lib/planner/transcript.ts'));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const illIndex = read('public/illinois/index.json');
const LITE = {
  illinois: (Array.isArray(illIndex) ? illIndex : illIndex.courses).map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: c.level, cluster: c.cluster, tags: c.tags })),
  uga: (() => { const u = read('public/uga-catalog.json'); return (Array.isArray(u) ? u : u.courses).filter((c) => typeof c?.code === 'string').map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: Number(c.code.match(/\d/)?.[0] ?? 0) * 100, cluster: c.cluster, tags: c.tags })); })(),
};

// [code, title, credits, right at UGA, right at Illinois]; '' is "no single course", '|' separates several right answers.
const A = [
  ['ENG 101', 'English Composition I', 3, 'ENGL 1101', 'RHET 105'],
  ['ENG 102', 'English Composition II', 3, 'ENGL 1102', ''],
  ['MAT 140', 'Precalculus', 4, 'MATH 1113', 'MATH 115'],
  ['MAT 201', 'Calculus I', 4, 'MATH 2250', 'MATH 221'],
  ['MAT 202', 'Calculus II', 4, 'MATH 2260', 'MATH 231'],
  ['MAT 203', 'Calculus III', 4, 'MATH 2270', 'MATH 241'],
  ['MAT 220', 'Introduction to Statistics', 3, 'STAT 2000', 'STAT 100'],
  ['PSY 101', 'Introduction to Psychology', 3, 'PSYC 1101', 'PSYC 100'],
  ['SOC 101', 'Introduction to Sociology', 3, 'SOCI 1101', 'SOC 100'],
  ['ECO 201', 'Principles of Macroeconomics', 3, 'ECON 2105', 'ECON 103'],
  ['ECO 202', 'Principles of Microeconomics', 3, 'ECON 2106', 'ECON 102'],
  ['ACC 201', 'Principles of Financial Accounting', 3, 'ACCT 2101', 'ACCY 201'],
  ['ACC 202', 'Principles of Managerial Accounting', 3, 'ACCT 2102', 'ACCY 202'],
  ['POL 101', 'American National Government', 3, 'POLS 1101', 'PS 101'],
  ['HIS 201', 'United States History to 1877', 3, 'HIST 2111', 'HIST 171'],
  ['HIS 202', 'United States History since 1877', 3, 'HIST 2112', 'HIST 172'],
  ['SPC 101', 'Fundamentals of Speech', 3, 'COMM 1110', 'CMN 101'],
  ['CHE 121', 'General Chemistry I', 4, 'CHEM 1211', 'CHEM 102'],
  ['CHE 122', 'General Chemistry II', 4, 'CHEM 1212', 'CHEM 104'],
  ['BIO 121', 'Principles of Biology I', 4, 'BIOL 1107', 'IB 150|MCB 150'],
  ['PHY 121', 'General Physics I', 4, 'PHYS 1111', 'PHYS 101'],
  ['PHY 221', 'University Physics I', 4, 'PHYS 1211', 'PHYS 211'],
  ['CSC 121', 'Introduction to Programming', 3, 'CSCI 1301', 'CS 124|CS 101'],
  ['SPA 101', 'Elementary Spanish I', 4, 'SPAN 1001', 'SPAN 101'],
  ['SPA 102', 'Elementary Spanish II', 4, 'SPAN 1002', 'SPAN 102'],
  ['SPA 201', 'Intermediate Spanish I', 3, 'SPAN 2001', 'SPAN 201'],
  ['PHI 101', 'Introduction to Philosophy', 3, 'PHIL 2010', 'PHIL 101'],
  ['BUS 210', 'Business Law I', 3, 'LEGL 2700', 'BADM 300'],
  ['ANT 101', 'Introduction to Anthropology', 3, 'ANTH 1102', 'ANTH 101'],
  ['FIN 201', 'Principles of Finance', 3, 'FINA 3000', 'FIN 221'],
  ['MKT 201', 'Principles of Marketing', 3, 'MARK 3000', 'BADM 320'],
  ['MGT 201', 'Principles of Management', 3, 'MGMT 3000', 'BADM 310'],
  ['HPE 101', 'Lifetime Fitness', 1, '', ''],
  ['ART 101', 'Art Appreciation', 3, 'ARTS 2000', ''],
];
const B = [
  ['WRIT 101', 'College Writing', 3, 'ENGL 1101', 'RHET 105'],
  ['WRIT 102', 'Writing and Research', 3, 'ENGL 1102', ''],
  ['MATH 151', 'Calculus of One Variable I', 4, 'MATH 2250', 'MATH 221'],
  ['MATH 116', 'Business Calculus', 3, 'MATH 2200', 'MATH 234'],
  ['STAT 101', 'Elementary Statistics', 3, 'STAT 2000', 'STAT 100'],
  ['PSYC 110', 'General Psychology', 3, 'PSYC 1101', 'PSYC 100'],
  ['ECON 110', 'Macroeconomic Principles', 3, 'ECON 2105', 'ECON 103'],
  ['ECON 111', 'Microeconomic Principles', 3, 'ECON 2106', 'ECON 102'],
  ['ACCT 211', 'Financial Accounting', 3, 'ACCT 2101', 'ACCY 201'],
  ['ACCT 212', 'Managerial Accounting', 3, 'ACCT 2102', 'ACCY 202'],
  ['PSCI 101', 'Introduction to American Government', 3, 'POLS 1101', 'PS 101'],
  ['HIST 151', 'American History I', 3, 'HIST 2111', 'HIST 171'],
  ['HIST 152', 'American History II', 3, 'HIST 2112', 'HIST 172'],
  ['COMM 101', 'Public Speaking', 3, 'COMM 1110', 'CMN 101'],
  ['CHEM 111', 'College Chemistry I', 4, 'CHEM 1211', 'CHEM 102'],
  ['BIOL 111', 'General Biology I', 4, 'BIOL 1107', 'IB 150|MCB 150'],
  ['PHYS 211', 'Physics for Scientists and Engineers I', 4, 'PHYS 1211', 'PHYS 211'],
  ['CS 141', 'Programming in Java', 3, 'CSCI 1301', 'CS 124|CS 101'],
  ['CS 142', 'Data Structures', 3, 'CSCI 2720|CSCI 1302', 'CS 128|CS 225'],
  ['SPAN 111', 'Beginning Spanish I', 4, 'SPAN 1001', 'SPAN 101'],
  ['PHIL 120', 'Introduction to Logic', 3, 'PHIL 2500|PHIL 2020', 'PHIL 102'],
  ['BADM 220', 'Legal Environment of Business', 3, 'LEGL 2700', 'BADM 300'],
  ['FIN 300', 'Corporate Finance', 3, 'FINA 3000', 'FIN 221'],
  ['MGMT 301', 'Organizational Behavior', 3, 'MGMT 3000', 'BADM 310'],
  ['MKTG 301', 'Marketing Principles', 3, 'MARK 3000', 'BADM 320'],
  ['CIS 110', 'Introduction to Information Systems', 3, 'MIST 2090', ''],
  ['SOC 110', 'Principles of Sociology', 3, 'SOCI 1101', 'SOC 100'],
  ['ECON 301', 'Intermediate Microeconomics', 3, 'ECON 4010', 'ECON 302'],
  ['ENGL 210', 'Introduction to Literature', 3, '', ''],
  ['MATH 098', 'Intermediate Algebra', 3, '', ''],
  ['PSYC 210', 'Abnormal Psychology', 3, '', 'PSYC 238'],
  ['NUTR 101', 'Nutrition', 3, 'NUTR 2100', 'FSHN 120'],
];

// A UGA transcript going to Illinois, like the owner's (2026-11-04). '?' has no answer key: only whether it was decided is scored.
const C = [
  ['BIOL 1103', 'Concepts in Biology', 3, '-', '?'],
  ['BIOL 1103L', 'Concepts in Biology Laboratory', 1, '-', '?'],
  ['MIST 2090', 'Introduction to Information Systems in Business', 3, '-', '?'],
  ['CMLT 2212', 'World Literature II', 3, '-', '?'],
  ['COMM 1500', 'Introduction to Interpersonal Communication', 3, '-', 'CMN 230'],
  ['GEOG 1112', 'Introduction to Weather and Climate', 3, '-', 'ATMS 100|ATMS 120'],
  ['ASTR 1010', 'Astronomy of the Solar System', 3, '-', 'ASTR 100|ASTR 121|ASTR 122'],
  ['FHCE 3200', 'Introduction to Personal Finance', 3, '-', 'ACE 240'],
  ['RMIN 4000', 'Risk Management', 3, '-', '?'],
  ['ANTH 1102', 'Introduction to Anthropology', 3, '-', 'ANTH 101'],
  ['SPAN 2001', 'Intermediate Spanish I', 3, '-', 'SPAN 201'],
  ['MUSI 2020', 'Introduction to Music', 3, '-', '?'],
  ['PEDB 1950', 'Fitness for Life Walking', 1, '-', ''],
  ['ECON 4750', 'Introduction to Econometrics', 3, '-', 'ECON 491'],
  ['STAT 2000', 'Introductory Statistics', 3, '-', 'STAT 100'],
  ['ENGL 1102', 'English Composition II', 3, '-', ''],
  ['ENGL 1101', 'English Composition I', 3, '-', 'RHET 105'],
  ['HIST 2112', 'American History Since 1865', 3, '-', 'HIST 172'],
  ['POLS 1101', 'American Government', 3, '-', 'PS 101'],
  ['GEOL 1121', 'Physical Geology', 3, '-', 'GEOL 100|GEOL 107'],
];

const AI = process.argv.includes('--ai');
const AIX = AI ? await import(join(ROOT, 'lib/planner/transfer-ai.ts')) : null;
const AIS = AI ? await import(join(ROOT, 'lib/planner/transfer-ai-server.ts')) : null;
const client = AI ? new (await import('@anthropic-ai/sdk')).default() : null;
let aiUsd = 0;
async function refined(rec, school, institution) {
  if (!AI) return rec;
  const lines = AIX.unsettledLines(rec, LITE[school], school);
  if (lines.length === 0) return rec;
  const out = await AIS.decideTransfers(client, school, institution, lines);
  const u = out.usage;
  aiUsd += ((u.input_tokens ?? 0) * 2 + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.output_tokens ?? 0) * 10) / 1e6;
  return AIX.applyDecisions(rec, lines, out.decisions, LITE[school], school);
}

const record = (rows, school, institution = 'Sample State University') => T.matchTranscript({
  institution,
  kind: 'transcript',
  hoursUnit: 'semester',
  courses: rows.map(([code, title, credits]) => ({ code, title, credits, grade: 'A', term: 'Fall 2025', status: 'completed' })),
  exams: [],
  notes: [],
}, 'bench.pdf', LITE[school], ['bench.pdf'], null, school, null, null);

const list = process.argv.includes('--list');
for (const school of ['uga', 'illinois']) {
  const tally = { 'counted right': 0, 'offered right': 0, 'counted WRONG': 0, 'offered wrong': 0, missed: 0, 'right as hours': 0 };
  const notes = [];
  let undecided = 0;
  let lines = 0;
  const sets = school === 'uga' ? [[A, 'Sample State University'], [B, 'Sample State University']] : [[A, 'Sample State University'], [B, 'Sample State University'], [C, 'University of Georgia']];
  for (const [rows, institution] of sets) {
    const rec = await refined(record(rows, school, institution), school, institution);
    for (const c of rec.courses) { lines += 1; if (c.counts === 'hours' && (!c.basis || c.basis.badge === 'not-evaluated') && !c.proposals?.length) undecided += 1; }
    rows.forEach((row, i) => {
      const key = school === 'uga' ? row[3] : row[4];
      const line = rec.courses[i];
      if (key === '?' || key === '-') {
        if (key === '?') notes.push(`  (no key)      ${row[0].padEnd(9)} ${row[1].padEnd(40)} got ${line.counts === 'course' ? line.matched : line.proposals?.[0] ? `maybe ${line.proposals[0].code}` : line.basis?.badge === 'elective' ? 'elective credit' : 'not evaluated'}: ${(line.basis?.text ?? '').slice(0, 110)}`);
        return;
      }
      const right = key.split('|').filter(Boolean);
      const counted = line.counts === 'course' ? line.matched : null;
      const offered = line.proposals?.[0]?.code ?? null;
      let verdict;
      if (counted) verdict = right.includes(counted) ? 'counted right' : 'counted WRONG';
      else if (right.length === 0) verdict = 'right as hours';
      else if (offered) verdict = right.includes(offered) ? 'offered right' : 'offered wrong';
      else verdict = 'missed';
      tally[verdict] += 1;
      if (verdict !== 'counted right' && verdict !== 'right as hours') notes.push(`  ${verdict.padEnd(14)} ${row[0].padEnd(9)} ${row[1].padEnd(40)} got ${counted ?? (offered ? `maybe ${offered}` : 'nothing')}, right: ${right.join(' or ') || 'no single course'}`);
    });
  }
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const good = tally['counted right'] + tally['right as hours'];
  console.log(`\n${school === 'uga' ? 'To UGA' : 'To Illinois'}${AI ? ' (with the AI step)' : ''}: ${good}/${total} handled right (${Math.round(good / total * 100)}%), ${tally['counted WRONG']} counted wrong; lines left with no answer at all: ${undecided}/${lines}`);
  console.log('  ' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' | '));
  if (list) console.log(notes.join('\n'));
}

if (!process.argv.includes('--no-sisters')) await sisterSets();
if (AI) console.log(`\nAI cost for this run: about $${aiUsd.toFixed(3)}`);

async function sisterSets() {
  const { readdirSync } = await import('node:fs');
  const { buildSisters } = await import(join(ROOT, 'scripts/data/uga-transfer-sisters.mjs'));
  const { loadSchools, measure } = await import(join(ROOT, 'scripts/dev/transfer-holdout.mjs'));
  const index = read('public/uga-transfer/index.json');
  const lists = {};
  for (const f of readdirSync(join(ROOT, 'public/uga-transfer'))) if (f.endsWith('.json') && f !== 'index.json') lists[f.replace('.json', '')] = read(`public/uga-transfer/${f}`);
  const sisterIndex = read('public/uga-transfer-sisters/index.json');
  const sisters = { index: sisterIndex, groups: Object.fromEntries(Object.entries(sisterIndex.groups).filter(([, g]) => g.file).map(([gid, g]) => [gid, read(`public/uga-transfer-sisters/${g.file}`)])) };
  const match = (institution, lines, table) => T.matchTranscript({ institution, kind: 'transcript', hoursUnit: 'semester', courses: lines, exams: [], notes: [] }, 'bench.pdf', LITE.uga, ['bench.pdf'], null, 'uga', table, null);
  const line = (code, title, credits) => ({ code, title, credits, grade: 'A', term: 'Fall 2025', status: 'completed' });

  // D: [code, title, credits, right at UGA]; '' is "no single course".
  const D = [
    ['ENC 1101', 'English Composition I', 3, 'ENGL 1101'],
    ['ENC 1102', 'English Composition II', 3, 'ENGL 1102'],
    ['AMH 2010', 'United States History to 1877', 3, 'HIST 2111'],
    ['AMH 2020', 'United States History since 1877', 3, 'HIST 2112'],
    ['ECO 2013', 'Principles of Macroeconomics', 3, 'ECON 2105'],
    ['ECO 2023', 'Principles of Microeconomics', 3, 'ECON 2106'],
    ['POS 2041', 'American National Government', 3, 'POLS 1101'],
    ['PSY 2012', 'General Psychology', 3, 'PSYC 1101'],
    ['SYG 2000', 'Introduction to Sociology', 3, 'SOCI 1101'],
    ['STA 2023', 'Elementary Statistics', 3, 'STAT 2000'],
    ['SPC 2608', 'Introduction to Public Speaking', 3, 'COMM 1110'],
    ['PHI 2010', 'Introduction to Philosophy', 3, 'PHIL 2010'],
    ['ARH 1000', 'Art Appreciation', 3, 'ARTS 2000'],
    ['MUL 1010', 'Music Appreciation', 3, 'MUSI 2020'],
    ['THE 2000', 'Theatre Appreciation', 3, 'THEA 2000'],
    ['SPN 1120', 'Elementary Spanish I', 4, 'SPAN 1001'],
    ['SPN 1121', 'Elementary Spanish II', 4, 'SPAN 1002'],
    ['MAC 2311', 'Calculus with Analytic Geometry I', 4, 'MATH 2250'],
    ['MAC 2312', 'Calculus with Analytic Geometry II', 4, 'MATH 2260'],
    ['BSC 2010', 'Biology I', 3, 'BIOL 1107'],
    ['ACG 2021', 'Principles of Financial Accounting', 3, 'ACCT 2101'],
    ['ACG 2071', 'Principles of Managerial Accounting', 3, 'ACCT 2102'],
    ['SLS 1101', 'College Success', 3, ''],
  ];
  // The first Florida College System college the planner holds no UGA list
  // for (lists keep arriving, so it is picked, not named: Daytona State had
  // none until 2026-11-05).
  const { sisterName } = await import(join(ROOT, 'lib/planner/transfer-sisters.ts'));
  const groupsDoc = read('scripts/data/uga-transfer-groups.json');
  const college = groupsDoc.groups['fl-college'].members.map((m) => m.name).find((name) => {
    const known = sisterIndex.groups['fl-college'].members.find((x) => x.names[0] === sisterName(name));
    return known && !known.key && !known.requirePlace;
  });
  if (!college) console.log('\nSister set D skipped: every Florida College System college now has its own UGA list.');
  for (const [label, table] of !college ? [] : [['without sister answers (before)', { index, schools: lists }], ['with sister answers', { index, schools: lists, sisters }]]) {
    const rec = match(college, D.map(([code, title, credits]) => line(code, title, credits)), table);
    const tally = { 'counted right': 0, 'offered right': 0, 'counted WRONG': 0, 'offered wrong': 0, missed: 0, 'right as hours': 0 };
    const notes = [];
    let fromSisters = 0;
    D.forEach((row, i) => {
      const c = rec.courses[i];
      if (c.basis?.from === 'sisters') fromSisters += 1;
      const right = row[3].split('|').filter(Boolean);
      const counted = c.counts === 'course' ? c.matched : null;
      const offered = c.proposals?.[0]?.code ?? null;
      const verdict = counted ? (right.includes(counted) ? 'counted right' : 'counted WRONG') : right.length === 0 ? 'right as hours' : offered ? (right.includes(offered) ? 'offered right' : 'offered wrong') : 'missed';
      tally[verdict] += 1;
      if (verdict !== 'counted right' && verdict !== 'right as hours') notes.push(`  ${verdict.padEnd(14)} ${row[0].padEnd(9)} ${row[1].padEnd(40)} got ${counted ?? (offered ? `maybe ${offered}` : 'nothing')}, right: ${right.join(' or ') || 'no single course'}`);
    });
    const good = tally['counted right'] + tally['right as hours'];
    console.log(`\nTo UGA, sister set D (${college}, no UGA list), ${label}: ${good}/${D.length} handled right, ${tally['counted WRONG']} counted wrong; ${fromSisters} lines answered by sister schools`);
    console.log('  ' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' | '));
    if (list) console.log(notes.join('\n'));
  }

  // E: each listed school in a lending group, hidden and predicted from its sisters.
  const { schools } = loadSchools();
  const results = measure();
  const full = { index, schools: lists };
  const outcome = (c) => `${c.counts}|${c.counts === 'course' ? [c.matched, ...(c.also ?? [])].join('+') : ''}|${c.designation ?? ''}`;
  const lending = Object.entries(sisterIndex.groups).filter(([, g]) => g.file).map(([gid]) => gid);
  console.log(`\nSister set E: each listed school in ${lending.join(', ')} hidden in turn and predicted from its sisters (rules only; compared with what its own list makes of the same line):`);
  for (const gid of lending) {
    const members = schools.filter((x) => x.group === gid && sisterIndex.groups[gid].members.some((m) => m.key === x.key));
    const t = { rows: 0, answered: 0, right: 0, creditWhereNone: 0, noneWhereCredit: 0, byKind: { course: [0, 0], hours: [0, 0], none: [0, 0] }, worst: null };
    const wrong = [];
    for (const hidden of members) {
      const built = buildSisters({ schools, results, hide: new Set([hidden.key]) });
      const file = built.files[`${gid}.json`];
      if (!file) continue;
      const { [hidden.key]: _gone, ...rest } = lists;
      const table = { index, schools: rest, sisters: { index: built.index, groups: { [gid]: file } } };
      const own = Object.keys(hidden.file.courses).filter((code) => hidden.file.courses[code]?.length);
      t.rows += own.length;
      const codes = own.filter((code) => file.courses[code]);
      if (codes.length === 0) continue;
      const lines = codes.map((code) => line(code.replace(/^([A-Z]+)(\d)/, '$1 $2'), null, 3));
      const name = hidden.name;
      // One line per transcript: two codes that become the same UGA course
      // (PSY 1101 and PSYC 1101) would otherwise count once and skew the score.
      const got = lines.map((l) => match(name, [l], table).courses[0]);
      const truth = lines.map((l) => match(name, [l], full).courses[0]);
      let right = 0;
      let answered = 0;
      got.forEach((c, i) => {
        if (c.basis?.from !== 'sisters') return;
        answered += 1;
        const ok = outcome(c) === outcome(truth[i]);
        const k = c.counts === 'course' ? 'course' : c.counts === 'hours' ? 'hours' : 'none';
        t.byKind[k][1] += 1;
        if (ok) { right += 1; t.byKind[k][0] += 1; } else wrong.push(`  ${name}: ${lines[i].code} sisters ${outcome(c)}, its own list ${outcome(truth[i])}`);
        if (c.counts !== 'none' && truth[i].counts === 'none') t.creditWhereNone += 1;
        if (c.counts === 'none' && truth[i].counts !== 'none') t.noneWhereCredit += 1;
      });
      t.answered += answered;
      t.right += right;
      if (answered >= 10) t.worst = Math.min(t.worst ?? 1, right / answered);
    }
    const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
    console.log(`  ${gid.padEnd(11)} ${members.length} lists, ${t.rows} rows: sisters answered ${t.answered} (${pct(t.answered, t.rows)}), same as the school's own list ${t.right}/${t.answered} (${pct(t.right, t.answered)}); as a course ${t.byKind.course[0]}/${t.byKind.course[1]}, as hours ${t.byKind.hours[0]}/${t.byKind.hours[1]}, no credit ${t.byKind.none[0]}/${t.byKind.none[1]}; credit where UGA gives none ${t.creditWhereNone}, no credit where UGA gives credit ${t.noneWhereCredit}; worst school ${t.worst === null ? '-' : pct(t.worst, 1)}`);
    if (list) console.log(wrong.join('\n'));
  }
}
