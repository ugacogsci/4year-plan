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
  ['CS 142', 'Data Structures', 3, 'CSCI 1302', 'CS 128|CS 225'],
  ['SPAN 111', 'Beginning Spanish I', 4, 'SPAN 1001', 'SPAN 101'],
  ['PHIL 120', 'Introduction to Logic', 3, 'PHIL 2500', 'PHIL 102'],
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

const record = (rows, school) => T.matchTranscript({
  institution: 'Sample State University',
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
  for (const rows of [A, B]) {
    const rec = record(rows, school);
    rows.forEach((row, i) => {
      const right = (school === 'uga' ? row[3] : row[4]).split('|').filter(Boolean);
      const line = rec.courses[i];
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
  console.log(`\n${school === 'uga' ? 'To UGA' : 'To Illinois'}: ${good}/${total} handled right (${Math.round(good / total * 100)}%), ${tally['counted WRONG']} counted wrong`);
  console.log('  ' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' | '));
  if (list) console.log(notes.join('\n'));
}
