/**
 * "Nothing needs attention" only when every check on the board passes
 * (attention.ts), and the early-finish note found for the board bar.
 *
 * Wrong on 2026-10-13 at both schools: the build's all-clear looked only at
 * unplaced courses and some unmet requirements, so boards short of the
 * degree, with courses before their prerequisites, credit that will not
 * count, or a requirement the planner could not read were told "Plan built.
 * Nothing needs attention."
 *
 * Changed on 2026-10-20 (the owner's "fewer pointless warnings",
 * warnings-triage.ts): credit that will not count, a requirement the planner
 * could not fully read, a course that has not run lately and a prerequisite
 * only the student can confirm are good to know, not problems. They are still
 * listed behind "Show N more"; __warnings-triage.check.mjs pins how.
 *
 *   node --experimental-strip-types lib/planner/__attention.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));
const { needsAttention, attentionItems, attentionLine, earlyFinishNote } = await import(join(HERE, 'attention.ts'));

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; return; }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
}
const issue = (id, severity, title) => ({ id, severity, title, message: '' });

// What used to pass as all-clear, each one now a problem.
for (const [why, i] of [
  ['the plan does not reach the degree', issue('degree-incomplete', 'error', 'This plan does not fulfill the degree yet')],
  ['a course before its prerequisite', issue('ap-prereq-order-fall-2027-chem-236-CHEM 223', 'warning', 'Prerequisite later in the plan')],
  ['a term over the limit', issue('ap-load-spring-2029', 'warning', 'Heavy course load')],
  ['two courses that do not both count', issue('ap-exclusion-fall-2027-math-220-math-221', 'info', 'These do not both count')],
  ['class times that clash', issue('weekly-clash-spring-2027', 'warning', 'Class times clash')],
  ['a class standing not reached', issue('ap-standing-fall-2027-psyc-301', 'error', 'Class standing not reached')],
  ['a requirement not met', issue('unmet-a::1-did-not-fit', 'error', 'Core: Statistics')],
]) check(`needs attention: ${why}`, needsAttention(i));

// What is information, not a problem.
for (const [why, i] of [
  // Good to know since 2026-10-20 (header): listed behind "Show N more", never dropped.
  ['credit given up for a required course', issue('ap-forfeit-CHEM 104', 'info', 'Credit that will not count')],
  ['a requirement the planner could not read', issue('unmet-aces/aces-undeclared::1::1-not-parsed', 'info', 'ACES Undeclared Core')],
  ['a course that has not run recently', issue('ap-dormant-fall-2028-anth-477', 'warning', 'Has not run recently')],
  ['a UGA requirement with unnamed hours', issue('unmet-62927::2-no-course-data', 'warning', 'Required Courses')],
  ['a prerequisite to confirm', issue('ap-prereq-check-fall-2027-mcb-246-MCB 244', 'warning', 'Check this one')],
  ['a requirement met by electives', issue('unmet-x::3-filled-by-electives', 'info', 'Free electives')],
  ['courses with no grade data', issue('ap-weighed-fall-2026', 'info', 'Some courses could not be weighed')],
  ['a credit range', issue('ap-variable-fall-2026', 'info', 'Credit range in this term')],
  ['the catalog prerequisite words', issue('ap-prereq-text-spring-2027-busn-3000', 'info', 'BUSN 3000: Second year student standing')],
]) check(`all clear despite: ${why}`, !needsAttention(i));

const board = [
  issue('ap-weighed-fall-2026', 'info', 'Some courses could not be weighed'),
  issue('ap-prereq-order-fall-2028-psyc-301-PSYC 235', 'warning', 'Prerequisite later in the plan'),
  issue('degree-incomplete', 'error', 'This plan does not fulfill the degree yet'),
  issue('ap-prereq-order-spring-2029-psyc-302-PSYC 235', 'warning', 'Prerequisite later in the plan'),
  issue('unmet-a::1-did-not-fit', 'error', 'Core: Statistics'),
  issue('unmet-a::2-not-parsed', 'info', 'Core: Advanced'),
  issue('ap-load-fall-2029', 'warning', 'Heavy course load'),
  issue('weekly-clash-spring-2027', 'warning', 'Class times clash'),
  issue('ap-dormant-spring-2029-anth-448', 'warning', 'Has not run recently'),
];
const items = attentionItems(board);
check('errors come first', items[0].severity === 'error', JSON.stringify(items));
check('one item per kind, with counts', items.find((i) => i.text === 'Prerequisite later in the plan')?.count === 2, JSON.stringify(items));
check('the degree summary and its requirement rows are one kind, not one per name', items.filter((i) => i.severity === 'error').length === 1 && items[0].count === 2, JSON.stringify(items));
check('information and good-to-know rows are left out', !items.some((i) => /weighed|not run|read/.test(i.text)), JSON.stringify(items));
const line = attentionLine(items);
console.log(`  ${line}`);
check('the line counts every problem', line.startsWith('6 things need attention: '), line);
check('the line shows three kinds and how many more', /; 1 more kind\./.test(line), line);
check('the line omits the redundant interface explanation', !/The dots by Rebuild|marks on courses/.test(line), line);
check('nothing to say when every check passes', attentionLine(attentionItems([board[0], board[5], board[8]])) === '');
check('one problem reads in the singular', attentionLine(attentionItems([board[7]])).startsWith('1 thing needs attention: Class times clash.'), attentionLine(attentionItems([board[7]])));

// The early-finish note, as autoplan.ts writes it, is what the board bar shows.
const early = 'This plan finishes in Fall 2029, 1 term before the Spring 2030 you asked for: the 81 credits you still need of the 120 this degree takes fit in 6 terms at about 14 a term.';
check('the early-finish note is found among the notes', earlyFinishNote(['Terms aim for about 14 credits.', early]) === early);
check('a default end the student never gave is not shown as theirs', earlyFinishNote(['This plan finishes in Fall 2029, 1 term before Spring 2030, because the courses left run out sooner.']) === null);
check('a plan ending in a semester abroad', earlyFinishNote(["This plan's courses end in Fall 2028, and your semester abroad in Spring 2029 after them is your last term, so it finishes in Spring 2029, 2 terms before the Spring 2030 you asked for: x"]) !== null);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
