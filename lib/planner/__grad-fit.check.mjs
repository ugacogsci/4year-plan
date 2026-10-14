/**
 * The graduation-date check during setup, at both schools.
 *
 * Wrong on 2026-10-14: a fourth-year UGA Risk Management and Insurance BBA
 * student graduating Spring 2027 was told in red that the date "does not
 * leave enough terms": 2 terms, 36 credits of room for a 120-credit degree,
 * as if they had no credit at all. The first screen now judges on what a
 * student in their year has usually earned (or the total they wrote), says
 * so softly, and the firm check waits for the credit they actually add.
 *
 *   node lib/planner/__grad-fit.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const { essentialsFitNote, creditFitNote, creditsStatedInText, priorCreditAdded } = await import(join(HERE, 'graduation-fit.ts'));
const { EMPTY_ANSWERS } = await import(join(HERE, 'onboarding.ts'));

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`ok   ${name}`);
  else { failures += 1; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`); }
}
const show = (note) => (note ? `${note.tone}: ${note.title} / ${note.message}` : 'no note');

// Real program totals from the shipped catalogs.
const uga = JSON.parse(readFileSync(join(PUBLIC, 'uga-programs.json'), 'utf8')).programs;
const rmi = uga.find((p) => p.name === 'Risk Management and Insurance BBA');
const illinois = JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'programs.json'), 'utf8'));
const finance = illinois.find((p) => p.id === 'bus/finance-bs');
const engineering = illinois.find((p) => /engineering\//.test(p.id) && (p.totalCredits ?? 0) >= 128);
check('catalog: UGA RMI BBA is in the shipped list', Boolean(rmi), 'missing');
check('catalog: Illinois Finance BS is in the shipped list', Boolean(finance), 'missing');

const ugaCatalog = { degrees: [{ id: rmi.id, totalCredits: rmi.totalCredits, additionalCredits: 30 }], additions: [] };
const ilCatalog = {
  degrees: illinois.map((p) => ({ id: p.id, totalCredits: p.totalCredits ?? null, additionalCredits: 30 })),
  additions: [{ id: 'minor/x', totalCredits: null, additionalCredits: 18 }],
};
const OCT = new Date(2026, 9, 14);
const JAN = new Date(2027, 0, 20);
const answers = (over) => ({ ...EMPTY_ANSWERS, ...over });
const transcript = (credits) => ({
  fileName: 'made-up.pdf', readAt: '2026-10-14', institution: 'Made-up College', notes: [], exams: [],
  courses: Array.from({ length: Math.round(credits / 3) }, (_, i) => ({
    code: `XYZ ${100 + i}`, title: null, credits: 3, grade: 'A', term: 'Fall 2024', status: 'completed',
    matched: null, matchedBy: null, use: true, counts: 'hours',
  })),
});

// 1. The owner's case: UGA RMI BBA, fourth year, Spring 2027.
const owner = answers({
  schoolId: 'uga', programIds: [rmi.id], collegeId: 'terry', academicYear: 'fourth',
  graduationSeason: 'Spring', graduationYear: 2027,
  timeline: 'I am a senior in risk management and want to graduate next spring.',
});
check('owner (UGA RMI BBA, fourth year, Spring 2027): no note on Check the essentials', essentialsFitNote(owner, ugaCatalog, OCT) === null, show(essentialsFitNote(owner, ugaCatalog, OCT)));
const ownerBlank = creditFitNote(owner, ugaCatalog, 0, OCT);
check('owner, nothing added on Credit: only a soft reminder, never the red warning', ownerBlank?.tone === 'soft', show(ownerBlank));
check('owner with a 96-credit record: no note after Credit', creditFitNote({ ...owner, transcript: transcript(96) }, ugaCatalog, 0, OCT) === null, show(creditFitNote({ ...owner, transcript: transcript(96) }, ugaCatalog, 0, OCT)));
check('owner with "about 95 credits" in their own words: no note', essentialsFitNote({ ...owner, academicYear: 'third', timeline: 'About 95 credits, graduating spring 2027.' }, ugaCatalog, OCT) === null, show(essentialsFitNote({ ...owner, academicYear: 'third', timeline: 'About 95 credits, graduating spring 2027.' }, ugaCatalog, OCT)));

// 2. Illinois fourth-year graduating next spring.
const ilSenior = answers({ schoolId: 'illinois', programIds: ['bus/finance-bs'], academicYear: 'fourth', graduationSeason: 'Spring', graduationYear: 2027 });
check('Illinois Finance BS, fourth year, Spring 2027: no note on Check the essentials', essentialsFitNote(ilSenior, ilCatalog, OCT) === null, show(essentialsFitNote(ilSenior, ilCatalog, OCT)));
check('Illinois fourth year with a 95-credit record: no note after Credit', creditFitNote({ ...ilSenior, transcript: transcript(96) }, ilCatalog, 0, OCT) === null, show(creditFitNote({ ...ilSenior, transcript: transcript(96) }, ilCatalog, 0, OCT)));
if (engineering) {
  const eng = { ...ilSenior, programIds: [engineering.id] };
  check(`Illinois ${engineering.totalCredits}-credit engineering degree, fourth year, Spring 2027: no note`, essentialsFitNote(eng, ilCatalog, OCT) === null, show(essentialsFitNote(eng, ilCatalog, OCT)));
}
check('Illinois fifth year, Spring 2027: no note', essentialsFitNote({ ...ilSenior, academicYear: 'fifth-plus' }, ilCatalog, OCT) === null);

// 3. A first-year asking for Spring 2027: an honest note, soft on the first screen, firm after Credit.
const fresh = answers({ schoolId: 'uga', programIds: [rmi.id], collegeId: 'terry', academicYear: 'first', graduationSeason: 'Spring', graduationYear: 2027 });
const freshNote = essentialsFitNote(fresh, ugaCatalog, OCT);
check('first year, Spring 2027: a note on Check the essentials', freshNote !== null, show(freshNote));
check('first year note is soft and says it will check again', freshNote?.tone === 'soft' && /check this again once you add the credit/i.test(freshNote.message), show(freshNote));
check('first year note states the true numbers (2 terms, 36 credits, 120-credit degree)', /2 terms through Spring 2027 hold/.test(freshNote?.message ?? '') && /36 credits/.test(freshNote?.message ?? '') && /120-credit/.test(freshNote?.message ?? ''), show(freshNote));
const freshCredit = creditFitNote(fresh, ugaCatalog, 0, OCT);
check('first year with no credit added: firm warning after Credit', freshCredit?.tone === 'warn', show(freshCredit));
check('first year with 12 AP credits: still a firm warning, naming the 12', /12 credits you have added/.test(creditFitNote(fresh, ugaCatalog, 12, OCT)?.message ?? '') && creditFitNote(fresh, ugaCatalog, 12, OCT)?.tone === 'warn', show(creditFitNote(fresh, ugaCatalog, 12, OCT)));

// 4. A third-year with 60 credits asking for one term.
const junior = answers({
  schoolId: 'illinois', programIds: ['bus/finance-bs'], academicYear: 'third', graduationSeason: 'Fall', graduationYear: 2026,
  timeline: 'Third year, 60 credits. I want to finish this fall.',
});
const juniorNote = essentialsFitNote(junior, ilCatalog, OCT);
check('third year, 60 credits, one term: a soft note on Check the essentials', juniorNote?.tone === 'soft' && /1 term through Fall 2026/.test(juniorNote.message), show(juniorNote));
const juniorTyped = { ...junior, transferText: '60 credit hours from Georgia State' };
const juniorCredit = creditFitNote(juniorTyped, ilCatalog, 0, OCT);
check('third year, 60 credits added, one term: firm warning after Credit', juniorCredit?.tone === 'warn', show(juniorCredit));
check('the warning is true: 60 added, about 64 still needed, 1 term holds 18', /60 credits you have added/.test(juniorCredit?.message ?? '') && /about 64/.test(juniorCredit?.message ?? '') && /1 term through Fall 2026 holds at most 18 credits/.test(juniorCredit?.message ?? ''), show(juniorCredit));
const juniorSpring = { ...junior, graduationSeason: 'Spring', graduationYear: 2027, transcript: transcript(60) };
check('third year, 60 credits, Spring 2027 as the one term left (in January): firm warning', creditFitNote(juniorSpring, ilCatalog, 0, JAN)?.tone === 'warn', show(creditFitNote(juniorSpring, ilCatalog, 0, JAN)));

// Program combinations judge the same way.
const ownerMinor = { ...ilSenior, minorIds: ['minor/x'] };
check('Illinois fourth year adding an 18-credit minor, Spring 2027: at most a soft note', (() => { const n = essentialsFitNote(ownerMinor, ilCatalog, OCT); return n === null || n.tone === 'soft'; })());

// Reading a stated total.
check('words: "about 95 credits" reads 95', creditsStatedInText('about 95 credits so far') === 95);
check('words: "60 credit hours" reads 60', creditsStatedInText('I have 60 credit hours') === 60);
check('words: "15 credits a semester" is a load, not a total', creditsStatedInText('I take 15 credits a semester') === null);
check('words: "need 30 more credits" is not what they have', creditsStatedInText('I need 30 more credits') === null);
check('words: a year is not credit', creditsStatedInText('graduate spring 2027') === null);
check('typed transfer: three course codes count as about 9', priorCreditAdded(answers({ transferText: 'ENGL 1101, MATH 1113 and HIST 2111 at Georgia Perimeter' }), 0) === 9);
check('marked UGA courses count about 3 each', priorCreditAdded(answers({ alreadyTakenCourseCodes: ['ACCT 2101', 'ACCT 2102'] }), 0) === 6);

// Nothing to judge.
check('undecided: no note', essentialsFitNote({ ...owner, programIds: ['__undecided__'] }, ugaCatalog, OCT) === null);
check('year not chosen yet: no note on Check the essentials', essentialsFitNote({ ...fresh, academicYear: '' }, ugaCatalog, OCT) === null);

console.log(failures === 0 ? 'grad-fit: all passed' : `grad-fit: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
